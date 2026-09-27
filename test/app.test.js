const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { openDb } = require('../lib/db');

let server;
let base;

before(async () => {
  // No data directory: PGlite keeps the database in memory for the test run.
  const app = createApp({ db: openDb(), adminEmail: 'admin@example.com' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function post(path, fields, cookie) {
  return fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie && { cookie }) },
    body: new URLSearchParams(fields),
  });
}

async function get(path, cookie) {
  return fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
}

async function signup(name, email) {
  const res = await post('/signup', { name, email, password: 'password123' });
  assert.strictEqual(res.status, 302);
  return res.headers.get('set-cookie').split(';')[0];
}

test('signed-out visitors are sent to sign in', async () => {
  for (const path of ['/', '/recipes', '/recipes/new']) {
    const res = await get(path);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/login');
  }
});

test('home page shows the welcome text and all three options', async () => {
  const cookie = await signup('Sam', 'sam@example.com');
  const html = await (await get('/', cookie)).text();
  assert.match(html, /Welcome to Cool Cooking Recipes/);
  assert.match(html, /href="\/recipes"[^>]*>Recipes</);
  assert.match(html, />Create recipe</);
  assert.match(html, />My recipes</);
  assert.match(html, /class="food-bg" aria-hidden="true"/);
  assert.match(html, /src="\/logo.svg"/);
});

test('new recipes wait for the admin to verify them', async () => {
  const cook = await signup('Cook', 'cook@example.com');
  const admin = await signup('Admin', 'Admin@Example.com');

  await post('/recipes', { title: 'Pancakes', ingredients: 'Flour\nEggs', steps: 'Mix\nFry' }, cook);

  let html = await (await get('/recipes', cook)).text();
  assert.doesNotMatch(html, /Pancakes/);
  assert.doesNotMatch(html, /Unverified recipes/);
  assert.strictEqual((await get('/recipes/unverified', cook)).status, 404);

  html = await (await get('/recipes', admin)).text();
  assert.match(html, /Unverified recipes/);
  html = await (await get('/recipes/unverified', admin)).text();
  assert.match(html, /Pancakes/);
  const id = html.match(/\/recipes\/(\d+)\/verify/)[1];

  assert.strictEqual((await post(`/recipes/${id}/verify`, {}, cook)).status, 404);
  assert.strictEqual((await post(`/recipes/${id}/verify`, {}, admin)).status, 302);

  html = await (await get('/recipes', cook)).text();
  assert.match(html, /Pancakes/);
  html = await (await get('/recipes/unverified', admin)).text();
  assert.doesNotMatch(html, /Pancakes/);
});

test('recipe text is escaped', async () => {
  const cookie = await signup('Eve', 'eve@example.com');
  await post('/recipes', { title: '<script>x</script>', ingredients: 'a', steps: 'b' }, cookie);
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  const html = await (await get('/recipes/unverified', admin)).text();
  assert.match(html, /&lt;script&gt;x/);
  assert.doesNotMatch(html, /<script>x/);
});

test('odd recipe ids return not found instead of crashing', async () => {
  const cookie = await signup('Ned', 'ned@example.com');
  for (const id of ['abc', '0', '-1', '99999999999999999999']) {
    assert.strictEqual((await get(`/recipes/${id}`, cookie)).status, 404);
  }
});

test('wrong password is rejected', async () => {
  await signup('Kim', 'kim@example.com');
  const res = await post('/login', { email: 'kim@example.com', password: 'nope' });
  assert.strictEqual(res.status, 401);
});

test('search finds verified recipes by name or ingredient', async () => {
  const cook = await signup('Lee', 'lee@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Banana Bread', ingredients: 'Bananas\nWalnuts', steps: 'Bake' }, cook);
  await post('/recipes', { title: 'Walnut Secret', ingredients: 'x', steps: 'y' }, cook);
  const mine = await (await get('/recipes/mine', cook)).text();
  const bananaId = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .find((m) => m[2].includes('Banana Bread'))[1];
  await post(`/recipes/${bananaId}/verify`, {}, admin);

  let html = await (await get('/recipes?q=walnut', cook)).text();
  assert.match(html, /Banana Bread/);
  assert.doesNotMatch(html, /Walnut Secret/, 'unverified recipes stay out of search');
  html = await (await get('/recipes?q=zzz', cook)).text();
  assert.match(html, /No recipes match/);
  html = await (await get('/recipes?q=%25', cook)).text();
  assert.match(html, /No recipes match/, '% is matched literally');
});

test('my recipes lists only your own recipes with their status', async () => {
  const me = await signup('Jo', 'jo@example.com');
  const other = await signup('Al', 'al@example.com');
  const res = await post('/recipes', { title: 'Jo Soup', ingredients: 'Water', steps: 'Boil' }, me);
  assert.strictEqual(res.headers.get('location'), '/recipes/mine?submitted=1');
  await post('/recipes', { title: 'Al Salad', ingredients: 'Lettuce', steps: 'Toss' }, other);
  const html = await (await get('/recipes/mine', me)).text();
  assert.match(html, /Jo Soup/);
  assert.match(html, /Waiting to be verified/);
  assert.doesNotMatch(html, /Al Salad/);
});

test('hearts add verified recipes to favorites and take them off again', async () => {
  const cook = await signup('Fay', 'fay@example.com');
  const fan = await signup('Gus', 'gus@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Heart Cake', ingredients: 'Cake', steps: 'Bake' }, cook);
  await post('/recipes', { title: 'Secret Pie', ingredients: 'Pie', steps: 'Bake' }, cook);
  const mine = await (await get('/recipes/mine', cook)).text();
  const idOf = (title) => [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes(title))[1];
  const cake = idOf('Heart Cake');
  const pie = idOf('Secret Pie');
  await post(`/recipes/${cake}/verify`, {}, admin);

  let html = await (await get('/recipes', fan)).text();
  assert.match(html, new RegExp(`action="/recipes/${cake}/favorite"`), 'verified recipes get a heart');
  assert.match(html, /aria-pressed="false"/);

  let res = await post(`/recipes/${cake}/favorite`, { favorite: '1', back: '/recipes' }, fan);
  assert.strictEqual(res.headers.get('location'), '/recipes');
  res = await post(`/recipes/${cake}/favorite`, { favorite: '1', back: '/recipes' }, fan);
  html = await (await get('/recipes/favorites', fan)).text();
  assert.match(html, /Heart Cake/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(await (await get('/recipes', fan)).text(), /class="count">1</, 'a second tap on "add" does not double count');

  assert.doesNotMatch(await (await get('/recipes/favorites', cook)).text(), /Heart Cake/, 'favorites are per person');

  res = await post(`/recipes/${pie}/favorite`, { favorite: '1' }, fan);
  assert.doesNotMatch(await (await get('/recipes/favorites', fan)).text(), /Secret Pie/, 'unverified recipes cannot be favorited');

  res = await fetch(`${base}/recipes/${cake}/favorite`, {
    method: 'POST',
    headers: { cookie: fan, 'x-requested-with': 'fetch', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'favorite=0',
  });
  assert.deepStrictEqual(await res.json(), { favorited: false });
  assert.match(await (await get('/recipes/favorites', fan)).text(), /favorited any recipes yet/);

  res = await post(`/recipes/${cake}/favorite`, { favorite: '1', back: '//evil.example' }, fan);
  assert.strictEqual(res.headers.get('location'), '/recipes', 'back only allows paths on this site');
});

test('profiles show the name and verified recipes, never the email', async () => {
  const chef = await signup('Chef Ana', 'ana.secret@example.com');
  const visitor = await signup('Vic', 'vic@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Ana Tacos', ingredients: 'Tortillas', steps: 'Fill' }, chef);
  await post('/recipes', { title: 'Ana Draft', ingredients: 'x', steps: 'y' }, chef);
  const mine = await (await get('/recipes/mine', chef)).text();
  const tacos = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Ana Tacos'))[1];
  await post(`/recipes/${tacos}/verify`, {}, admin);

  const list = await (await get('/recipes', visitor)).text();
  const profileUrl = list.match(/href="(\/users\/\d+)" class="person">[\s\S]*?Chef Ana/)[1];

  const html = await (await get(profileUrl, visitor)).text();
  assert.match(html, /<h1>Chef Ana<\/h1>/);
  assert.match(html, /Ana Tacos/);
  assert.doesNotMatch(html, /Ana Draft/, 'unverified recipes stay off profiles');
  assert.doesNotMatch(html, /ana\.secret@example\.com/, 'emails are never shown');
  assert.doesNotMatch(html, /Change profile/, 'only the owner sees Change profile');

  const own = await (await get(profileUrl, chef)).text();
  assert.match(own, /href="\/profile"[^>]*>Change profile/);
  assert.doesNotMatch(own, /ana\.secret@example\.com/);
  assert.strictEqual((await get('/users/abc', visitor)).status, 404);
});

test('change profile updates only your own name and picture', async () => {
  const me = await signup('Pat', 'pat@example.com');
  const other = await signup('Quinn', 'quinn@example.com');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  let res = await post('/profile', { name: 'Pat Cook', avatar: `data:image/png;base64,${png.toString('base64')}` }, me);
  assert.strictEqual(res.status, 302);
  const profileUrl = res.headers.get('location');
  const html = await (await get(profileUrl, other)).text();
  assert.match(html, /<h1>Pat Cook<\/h1>/);
  const src = html.match(/src="(\/users\/\d+\/avatar\?v=\d+)"/)[1];

  res = await get(src, other);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));

  const fake = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  res = await post('/profile', { name: 'Pat Cook', avatar: `data:image/png;base64,${fake}` }, me);
  assert.strictEqual(res.status, 400, 'files that are not really images are rejected');
  res = await post('/profile', { name: 'Pat Cook', avatar: `data:image/svg+xml;base64,${fake}` }, me);
  assert.strictEqual(res.status, 400);

  // Quinn's form post can only ever change Quinn.
  await post('/profile', { name: 'Hacked' }, other);
  assert.match(await (await get(profileUrl, other)).text(), /<h1>Pat Cook<\/h1>/);

  await post('/profile/avatar/remove', {}, me);
  const after = await (await get(profileUrl, other)).text();
  assert.doesNotMatch(after, /\/avatar\?v=/);
  assert.match(after, /class="avatar initial"/);
});
