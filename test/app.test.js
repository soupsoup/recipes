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

test('food pictures can be picked, and a photo or another pick replaces them', async () => {
  const me = await signup('Rae', 'rae@example.com');
  const viewer = await signup('Sol', 'sol@example.com');

  let html = await (await get('/profile', me)).text();
  for (const food of ['donut', 'spaghetti', 'pizza', 'sandwich', 'onion', 'apple', 'cheeseburger', 'orange', 'cupcake', 'cake', 'lollipop', 'chocolate', 'pineapple']) {
    assert.match(html, new RegExp(`name="preset" value="${food}"`), `${food} is offered`);
  }

  let res = await post('/profile', { name: 'Rae', preset: 'pizza' }, me);
  const profileUrl = res.headers.get('location');
  html = await (await get(profileUrl, viewer)).text();
  assert.match(html, /class="avatar preset"[^>]*>🍕</);
  assert.match(await (await get('/profile', me)).text(), /value="pizza" checked/);

  res = await post('/profile', { name: 'Rae', preset: 'poison' }, me);
  assert.strictEqual(res.status, 400, 'only the listed foods are allowed');

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await post('/profile', { name: 'Rae', avatar: `data:image/png;base64,${png}` }, me);
  html = await (await get(profileUrl, viewer)).text();
  assert.doesNotMatch(html, /avatar preset/, 'a photo replaces the food picture');
  assert.match(html, /\/avatar\?v=\d+/);

  await post('/profile', { name: 'Rae', preset: 'donut' }, me);
  html = await (await get(profileUrl, viewer)).text();
  assert.match(html, />🍩</);
  assert.doesNotMatch(html, /\/avatar\?v=\d+/, 'a food pick replaces the photo');
});

test('recipes can have a photo that follows the same visibility as the recipe', async () => {
  const cook = await signup('Uma', 'uma@example.com');
  const other = await signup('Val', 'val@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

  let res = await post('/recipes', {
    title: 'Photo Pie', ingredients: 'Pie', steps: 'Bake', photo: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
  }, cook);
  assert.strictEqual(res.status, 302);
  const mine = await (await get('/recipes/mine', cook)).text();
  const [, id, version] = mine.match(/src="\/recipes\/(\d+)\/photo\?v=(\d+)"/);

  assert.strictEqual((await get(`/recipes/${id}/photo?v=${version}`, cook)).status, 200, 'the author sees it');
  assert.strictEqual((await get(`/recipes/${id}/photo`, other)).status, 404, 'others wait for verification');
  const pending = await (await get('/recipes/unverified', admin)).text();
  assert.match(pending, new RegExp(`/recipes/${id}/photo`), 'the admin sees the photo while reviewing');

  await post(`/recipes/${id}/verify`, {}, admin);
  res = await get(`/recipes/${id}/photo?v=${version}`, other);
  assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(jpeg));
  assert.match(await (await get(`/recipes/${id}`, other)).text(), /class="recipe-photo"/);

  const fake = Buffer.from('<html>not a photo</html>').toString('base64');
  res = await post('/recipes', { title: 'Bad', ingredients: 'x', steps: 'y', photo: `data:image/jpeg;base64,${fake}` }, cook);
  assert.strictEqual(res.status, 400);

  res = await post('/recipes', { title: 'No Photo Soup', ingredients: 'Water', steps: 'Boil' }, cook);
  assert.strictEqual(res.status, 302, 'the photo is optional');
  assert.match(await (await get('/recipes/new', cook)).text(), />Upload photo\s*</);
});

test('authors can edit their recipes, and edits to verified recipes are reviewed again', async () => {
  const cook = await signup('Wes', 'wes@example.com');
  const other = await signup('Xia', 'xia@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  const jpeg = (n) => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]).toString('base64')}`;

  await post('/recipes', { title: 'Wes Chili', ingredients: 'Beans', steps: 'Simmer', photo: jpeg(1) }, cook);
  const mine = await (await get('/recipes/mine', cook)).text();
  const id = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Wes Chili'))[1];
  assert.match(mine, new RegExp(`href="/recipes/${id}/edit"`), 'My recipes has an Edit button');
  await post(`/recipes/${id}/verify`, {}, admin);

  // Only the author gets the edit page and button.
  assert.strictEqual((await get(`/recipes/${id}/edit`, other)).status, 404);
  assert.strictEqual((await post(`/recipes/${id}/edit`, { title: 'Hacked', ingredients: 'x', steps: 'y' }, other)).status, 404);
  assert.doesNotMatch(await (await get(`/recipes/${id}`, other)).text(), /Edit recipe/);
  assert.match(await (await get(`/recipes/${id}`, cook)).text(), new RegExp(`href="/recipes/${id}/edit"[^>]*>Edit recipe`));

  const form = await (await get(`/recipes/${id}/edit`, cook)).text();
  assert.match(form, /value="Wes Chili"/, 'the form starts with the current recipe');
  assert.match(form, /sends this recipe back to be verified/);

  // Editing a verified recipe: text changes, photo kept, recipe hidden until verified again.
  const res = await post(`/recipes/${id}/edit`, { title: 'Wes Spicy Chili', ingredients: 'Beans\nChili', steps: 'Simmer' }, cook);
  assert.strictEqual(res.headers.get('location'), `/recipes/${id}?edited=1`);
  let page = await (await get(`/recipes/${id}?edited=1`, cook)).text();
  assert.match(page, /Wes Spicy Chili/);
  assert.match(page, /class="recipe-photo"/, 'leaving the photo alone keeps it');
  assert.match(page, /once they have been verified/);
  assert.strictEqual((await get(`/recipes/${id}`, other)).status, 404, 'hidden again until re-verified');
  assert.match(await (await get('/recipes/unverified', admin)).text(), /Wes Spicy Chili/);

  // Removing and replacing the photo.
  await post(`/recipes/${id}/edit`, { title: 'Wes Spicy Chili', ingredients: 'Beans', steps: 'Simmer', remove_photo: '1' }, cook);
  assert.doesNotMatch(await (await get(`/recipes/${id}`, cook)).text(), /class="recipe-photo"/);
  await post(`/recipes/${id}/edit`, { title: 'Wes Spicy Chili', ingredients: 'Beans', steps: 'Simmer', photo: jpeg(2) }, cook);
  assert.match(await (await get(`/recipes/${id}`, cook)).text(), /class="recipe-photo"/);

  assert.strictEqual((await post(`/recipes/${id}/edit`, { title: '', ingredients: 'x', steps: 'y' }, cook)).status, 400);

  // The admin's own recipes stay verified when edited.
  await post('/recipes', { title: 'Admin Stew', ingredients: 'Stew', steps: 'Cook' }, admin);
  const adminMine = await (await get('/recipes/mine', admin)).text();
  const stew = [...adminMine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Admin Stew'))[1];
  await post(`/recipes/${stew}/verify`, {}, admin);
  await post(`/recipes/${stew}/edit`, { title: 'Admin Stew v2', ingredients: 'Stew', steps: 'Cook' }, admin);
  assert.match(await (await get('/recipes', other)).text(), /Admin Stew v2/);
});

test('comments and replies work like YouTube, with the right people allowed to delete', async () => {
  const chef = await signup('Yara', 'yara@example.com');
  const fan = await signup('Zed', 'zed@example.com');
  const troll = await signup('Tom', 'tom@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Yara Curry', ingredients: 'Curry', steps: 'Cook' }, chef);
  const mine = await (await get('/recipes/mine', chef)).text();
  const id = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Yara Curry'))[1];

  // No comments until the recipe is verified.
  assert.strictEqual((await post(`/recipes/${id}/comments`, { body: 'Early!' }, fan)).status, 404);
  await post(`/recipes/${id}/verify`, {}, admin);

  let res = await post(`/recipes/${id}/comments`, { body: 'This looks <b>amazing</b>!' }, fan);
  assert.match(res.headers.get('location'), new RegExp(`^/recipes/${id}#comment-\\d+$`));
  const commentId = res.headers.get('location').match(/comment-(\d+)/)[1];
  await post(`/recipes/${id}/comments`, { body: 'first!!' }, troll);

  let html = await (await get(`/recipes/${id}`, chef)).text();
  assert.match(html, /2 Comments/);
  assert.match(html, /This looks &lt;b&gt;amazing&lt;\/b&gt;!/, 'comment text is escaped');
  assert.match(html, /just now/);
  assert.ok(html.indexOf('first!!') < html.indexOf('This looks'), 'newest comments first');

  // Replies join the top-level thread; replying to a reply adds an @mention and stays in the same thread.
  res = await post(`/recipes/${id}/comments`, { body: 'Thank you!', parent_id: commentId }, chef);
  assert.match(res.headers.get('location'), new RegExp(`\\?thread=${commentId}#comment-`));
  html = await (await get(`/recipes/${id}?thread=${commentId}`, fan)).text();
  assert.match(html, /1 reply/);
  assert.match(html, /<details class="replies" open>/);
  assert.match(html, /<span class="creator">Chef<\/span>/, 'the recipe author is marked like a YouTube creator');
  assert.match(html, /@Yara <\/textarea>/, 'reply to a reply is prefilled with an @mention');
  const lastIdBefore = (page, text) => [...page.slice(0, page.indexOf(text)).matchAll(/id="comment-(\d+)"/g)].pop()[1];
  const replyId = lastIdBefore(html, 'Thank you!');
  await post(`/recipes/${id}/comments`, { body: 'nested?', parent_id: replyId }, fan);
  assert.doesNotMatch(await (await get(`/recipes/${id}`, fan)).text(), /nested\?/, 'replies can only hang off top-level comments');

  // Deleting: not someone else's comment, but yes your own, the chef on their recipe, and the admin.
  const trollComment = lastIdBefore(await (await get(`/recipes/${id}`, troll)).text(), 'first!!');
  assert.strictEqual((await post(`/comments/${commentId}/delete`, {}, troll)).status, 404);
  assert.doesNotMatch(
    (await (await get(`/recipes/${id}`, troll)).text()).split(`id="comment-${commentId}"`)[1].split('class="thread"')[0],
    /\/delete"/,
    'no Delete button on other people\'s comments',
  );
  await post(`/comments/${trollComment}/delete`, {}, chef);
  html = await (await get(`/recipes/${id}`, fan)).text();
  assert.doesNotMatch(html, /first!!/);
  await post(`/comments/${commentId}/delete`, {}, fan);
  html = await (await get(`/recipes/${id}`, fan)).text();
  assert.doesNotMatch(html, /This looks|Thank you!/, 'deleting a comment removes its replies too');
  assert.match(html, /0 Comments/);
});

test('the recipe creator can turn comments off and back on', async () => {
  const chef = await signup('Abe', 'abe@example.com');
  const fan = await signup('Bea', 'bea@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Abe Ramen', ingredients: 'Noodles', steps: 'Boil' }, chef);
  const mine = await (await get('/recipes/mine', chef)).text();
  const id = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Abe Ramen'))[1];
  await post(`/recipes/${id}/verify`, {}, admin);
  await post(`/recipes/${id}/comments`, { body: 'Yum ramen' }, fan);

  assert.match(await (await get(`/recipes/${id}`, chef)).text(), />Turn off comments</);
  assert.doesNotMatch(await (await get(`/recipes/${id}`, fan)).text(), /Turn off comments/, 'only the creator sees the switch');
  assert.strictEqual((await post(`/recipes/${id}/comments/toggle`, { off: '1' }, fan)).status, 404, 'others cannot flip it');
  assert.strictEqual((await post(`/recipes/${id}/comments/toggle`, { off: '1' }, admin)).status, 404);

  await post(`/recipes/${id}/comments/toggle`, { off: '1' }, chef);
  let html = await (await get(`/recipes/${id}`, fan)).text();
  assert.match(html, /Comments are turned off\./);
  assert.doesNotMatch(html, /Yum ramen/, 'existing comments are hidden');
  assert.doesNotMatch(html, /Add a comment/);
  await post(`/recipes/${id}/comments`, { body: 'sneaky' }, fan);
  assert.match(await (await get(`/recipes/${id}`, chef)).text(), />Turn on comments</);

  await post(`/recipes/${id}/comments/toggle`, { off: '0' }, chef);
  html = await (await get(`/recipes/${id}`, fan)).text();
  assert.match(html, /Yum ramen/, 'turning comments back on brings the old ones back');
  assert.doesNotMatch(html, /sneaky/, 'nothing could be posted while comments were off');
  assert.match(html, /1 Comment</);
});

test('recipes can show an Instagram or YouTube video, and only real video links are accepted', async () => {
  const cook = await signup('Vid', 'vid@example.com');
  const viewer = await signup('Wat', 'wat@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];

  let res = await post('/recipes', {
    title: 'Video Wings', ingredients: 'Wings', steps: 'Bake', video_url: 'https://www.instagram.com/p/Cz5AROnOK3l/?igsh=abc',
  }, cook);
  assert.strictEqual(res.status, 302);
  const mine = await (await get('/recipes/mine', cook)).text();
  const id = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes('Video Wings'))[1];
  assert.match(mine, /class="play-badge"/, 'cards show that the recipe has a video');
  await post(`/recipes/${id}/verify`, {}, admin);

  let html = await (await get(`/recipes/${id}`, viewer)).text();
  assert.match(html, /<iframe src="https:\/\/www\.instagram\.com\/p\/Cz5AROnOK3l\/embed"/);
  assert.match(html, /Watch on Instagram/);
  assert.doesNotMatch(html, /igsh=abc/, 'tracking bits of the pasted link are dropped');

  // Bad links are turned away with a message, and the rest of the form is kept.
  for (const bad of ['https://evil.example/reel/abc', 'javascript:alert(1)', 'https://www.instagram.com/someuser/', 'hello']) {
    res = await post('/recipes', { title: 'Bad Video', ingredients: 'x', steps: 'y', video_url: bad }, cook);
    assert.strictEqual(res.status, 400, bad);
    const page = await res.text();
    assert.match(page, /video link didn&#39;t work/);
    assert.match(page, /value="Bad Video"/);
  }

  // Editing: switch to a YouTube Short, then remove the video.
  const form = await (await get(`/recipes/${id}/edit`, cook)).text();
  assert.match(form, /name="video_url"[^>]*value="https:\/\/www\.instagram\.com\/p\/Cz5AROnOK3l\/"/);
  await post(`/recipes/${id}/edit`, { title: 'Video Wings', ingredients: 'Wings', steps: 'Bake', video_url: 'https://youtube.com/shorts/dQw4w9WgXcQ' }, cook);
  html = await (await get(`/recipes/${id}`, cook)).text();
  assert.match(html, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /video-frame youtube vertical/);
  await post(`/recipes/${id}/edit`, { title: 'Video Wings', ingredients: 'Wings', steps: 'Bake', video_url: '' }, cook);
  assert.doesNotMatch(await (await get(`/recipes/${id}`, cook)).text(), /<iframe/);
});

test('only the admin can edit and delete everyone\'s recipes', async () => {
  const cook = await signup('Ollie', 'ollie@example.com');
  const other = await signup('Pia', 'pia@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  await post('/recipes', { title: 'Ollie Tacos', ingredients: 'Tortillas', steps: 'Fill' }, cook);
  await post('/recipes', { title: 'Ollie Draft', ingredients: 'x', steps: 'y' }, cook);
  const mine = await (await get('/recipes/mine', cook)).text();
  const idOf = (t) => [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes(t))[1];
  const tacos = idOf('Ollie Tacos');
  const draft = idOf('Ollie Draft');
  await post(`/recipes/${tacos}/verify`, {}, admin);

  // Other people can't edit or delete someone else's recipe, by button or by URL.
  let html = await (await get(`/recipes/${tacos}`, other)).text();
  assert.doesNotMatch(html, /\/edit"|Delete recipe/);
  assert.strictEqual((await get(`/recipes/${tacos}/edit`, other)).status, 404);
  assert.strictEqual((await post(`/recipes/${tacos}/edit`, { title: 'Hacked', ingredients: 'x', steps: 'y' }, other)).status, 404);
  assert.strictEqual((await post(`/recipes/${tacos}/delete`, {}, other)).status, 404);
  assert.strictEqual((await post(`/recipes/${tacos}/delete`, {}, cook)).status, 404, 'authors cannot delete either');

  // The admin gets Edit and Delete on everyone's recipes, published or waiting.
  html = await (await get(`/recipes/${tacos}`, admin)).text();
  assert.match(html, new RegExp(`href="/recipes/${tacos}/edit"`));
  assert.match(html, /Delete recipe/);
  assert.match(await (await get(`/recipes/${draft}`, admin)).text(), new RegExp(`href="/recipes/${draft}/edit"`));

  // The admin's edits keep the recipe's status and author, and the form says whose it is.
  assert.match(await (await get(`/recipes/${tacos}/edit`, admin)).text(), /editing Ollie's recipe as the admin/);
  await post(`/recipes/${tacos}/edit`, { title: 'Ollie Fish Tacos', ingredients: 'Tortillas\nFish', steps: 'Fill' }, admin);
  html = await (await get(`/recipes/${tacos}`, other)).text();
  assert.match(html, /Ollie Fish Tacos/, 'still published after the admin edits it');
  assert.match(html, /by[\s\S]*?Ollie/, 'still Ollie\'s recipe');
  await post(`/recipes/${draft}/edit`, { title: 'Ollie Draft Fixed', ingredients: 'x', steps: 'y' }, admin);
  assert.match(await (await get('/recipes/unverified', admin)).text(), /Ollie Draft Fixed/, 'a waiting recipe stays waiting');

  // The author can still edit their own.
  assert.match(await (await get(`/recipes/${tacos}`, cook)).text(), new RegExp(`href="/recipes/${tacos}/edit"`));

  // Deleting a published recipe takes it away for everyone.
  const res = await post(`/recipes/${tacos}/delete`, {}, admin);
  assert.match(res.headers.get('location'), /^\/recipes\?deleted=/);
  assert.match(await (await get(res.headers.get('location'), admin)).text(), /Deleted &quot;Ollie Fish Tacos&quot;/);
  assert.strictEqual((await get(`/recipes/${tacos}`, other)).status, 404);
});

test('the admin sorts published recipes into sections that everyone can browse', async () => {
  const cook = await signup('Quin', 'quin@example.com');
  const other = await signup('Rex', 'rex@example.com');
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];

  // Only the admin manages sections.
  assert.strictEqual((await get('/sections', other)).status, 404);
  assert.strictEqual((await post('/sections', { name: 'Sneaky', emoji: '😈' }, other)).status, 404);
  for (const [name, emoji] of [['Burgers', '🍔'], ['Chicken', '🍗'], ['Simple Snacks', '🍿']]) {
    await post('/sections', { name, emoji }, admin);
  }
  assert.strictEqual((await post('/sections', { name: 'Chicken', emoji: '' }, admin)).status, 400, 'no duplicate names');
  const manage = await (await get('/sections', admin)).text();
  const idOf = (name) => [...manage.slice(0, manage.indexOf(`value="${name}"`)).matchAll(/action="\/sections\/(\d+)"/g)].pop()[1];
  const burgers = idOf('Burgers');
  const chicken = idOf('Chicken');

  await post('/recipes', { title: 'Quin Chicken Burger', ingredients: 'Chicken\nBun', steps: 'Grill' }, cook);
  await post('/recipes', { title: 'Quin Crispy Tenders', ingredients: 'Chicken', steps: 'Fry' }, cook);
  const mine = await (await get('/recipes/mine', cook)).text();
  const rid = (t) => [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes(t))[1];
  const burger = rid('Chicken Burger');
  const tenders = rid('Crispy Tenders');
  for (const id of [burger, tenders]) await post(`/recipes/${id}/verify`, {}, admin);

  // The admin ticks sections on a recipe; a recipe can be in more than one.
  assert.match(await (await get(`/recipes/${burger}`, admin)).text(), /name="section_ids"/);
  assert.doesNotMatch(await (await get(`/recipes/${burger}`, cook)).text(), /name="section_ids"/, 'only the admin sees the checkboxes');
  assert.strictEqual((await post(`/recipes/${burger}/sections`, { section_ids: chicken }, cook)).status, 404);
  const body = new URLSearchParams([['section_ids', burgers], ['section_ids', chicken], ['section_ids', '999999']]);
  await fetch(`${base}/recipes/${burger}/sections`, {
    method: 'POST', redirect: 'manual', headers: { cookie: admin, 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  await post(`/recipes/${tenders}/sections`, { section_ids: chicken }, admin);

  // Everyone sees the section buttons, and each one filters the list.
  let html = await (await get('/recipes', other)).text();
  assert.match(html, /class="section-chips"/);
  assert.match(html, />🍗<\/span> Chicken</);
  assert.doesNotMatch(html, /Manage sections/, 'only the admin gets the manage link');
  html = await (await get(`/recipes?section=${chicken}`, other)).text();
  assert.match(html, /Quin Chicken Burger/);
  assert.match(html, /Quin Crispy Tenders/);
  html = await (await get(`/recipes?section=${burgers}`, other)).text();
  assert.match(html, /Quin Chicken Burger/);
  assert.doesNotMatch(html, /Quin Crispy Tenders/);
  html = await (await get(`/recipes?section=${chicken}&q=tenders`, other)).text();
  assert.match(html, /Quin Crispy Tenders/, 'search works inside a section');
  assert.doesNotMatch(html, /Quin Chicken Burger/);
  const snacks = idOf('Simple Snacks');
  assert.match(await (await get(`/recipes?section=${snacks}`, other)).text(), /No recipes in Simple Snacks yet/);

  // The recipe page shows its sections to everyone.
  html = await (await get(`/recipes/${burger}`, other)).text();
  assert.match(html, new RegExp(`href="/recipes\\?section=${burgers}" class="chip small"`));
  assert.match(html, new RegExp(`href="/recipes\\?section=${chicken}" class="chip small"`));

  // Renaming and deleting sections; deleting keeps the recipes.
  await post(`/sections/${chicken}`, { name: 'Chicken Dishes', emoji: '🐔' }, admin);
  assert.match(await (await get('/recipes', other)).text(), />🐔<\/span> Chicken Dishes</);
  await post(`/sections/${burgers}/delete`, {}, admin);
  html = await (await get('/recipes', other)).text();
  assert.doesNotMatch(html, /Burgers</);
  assert.match(html, /Quin Chicken Burger/, 'recipes stay after their section is deleted');
});
