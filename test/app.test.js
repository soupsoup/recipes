const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');

let server;
let base;

before(async () => {
  const app = createApp({ dbFile: ':memory:', adminEmail: 'admin@example.com' });
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
  const bananaId = [...mine.matchAll(/href="\/recipes\/(\d+)">([\s\S]*?)<\/a>/g)]
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
