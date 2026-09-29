const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { openDb } = require('../lib/db');

// A clock the test can move, to walk through September, October and November.
let clock = new Date('2026-09-20T12:00:00-04:00');
let server;
let base;

before(async () => {
  const app = createApp({ db: openDb(), adminEmail: 'admin@example.com', now: () => clock });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const form = (cookie, fields) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie && { cookie }) },
  body: new URLSearchParams(fields),
});
const post = (path, fields, cookie) => fetch(base + path, form(cookie, fields));
const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const page = async (path, cookie) => (await get(path, cookie)).text();

async function signup(name, email) {
  const res = await post('/signup', { name, email, password: 'password123' });
  return res.headers.get('set-cookie').split(';')[0];
}

async function verifiedRecipe(cook, admin, title) {
  await post('/recipes', { title, ingredients: 'Spooky stuff', steps: 'Cook' }, cook);
  const mine = await page('/recipes/mine', cook);
  const id = [...mine.matchAll(/href="\/recipes\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[2].includes(title))[1];
  await post(`/recipes/${id}/verify`, {}, admin);
  return id;
}

const heart = (id, cookie) => post(`/recipes/${id}/favorite`, { favorite: '1' }, cookie);

test('the Spooky Food Contest runs in October and crowns the most-hearted entry', async () => {
  const admin = await signup('Admin', 'admin@example.com');
  const nicole = await signup('Nicole', 'nicole@example.com');
  const anthony = await signup('Anthony', 'anthony@example.com');
  const fans = [await signup('Fan One', 'f1@example.com'), await signup('Fan Two', 'f2@example.com')];
  const grilledCheese = await verifiedRecipe(nicole, admin, 'Spooky Grilled Cheese');
  const tacoDip = await verifiedRecipe(nicole, admin, 'Halloween Taco Dip');
  const lasagna = await verifiedRecipe(anthony, admin, 'The Best Lasagna Ever');

  // September: normal menu, no contest. A heart given now won't count as a vote later.
  const early = await signup('Early Fan', 'early@example.com');
  await heart(grilledCheese, early);
  let home = await page('/', fans[0]);
  assert.doesNotMatch(home, /home spooky|Spooky Food Contest/);
  assert.doesNotMatch(await page(`/recipes/${grilledCheese}`, nicole), /Enter the Spooky Food Contest/);
  assert.strictEqual((await post(`/recipes/${grilledCheese}/contest`, { enter: '1' }, nicole)).status, 404);

  // October: spooky menu and contest open.
  clock = new Date('2026-10-05T12:00:00-04:00');
  home = await page('/', fans[0]);
  assert.match(home, /class="home spooky"/);
  assert.match(home, /🎃 Happy Halloween!/);
  assert.match(home, /href="\/contest"/);
  assert.match(home, /🦇/);

  assert.match(await page(`/recipes/${grilledCheese}`, nicole), /Enter the Spooky Food Contest/);
  assert.doesNotMatch(await page(`/recipes/${grilledCheese}`, fans[0]), /Enter the Spooky Food Contest/, 'only the creator can enter');
  assert.strictEqual((await post(`/recipes/${grilledCheese}/contest`, { enter: '1' }, fans[0])).status, 404);

  await post(`/recipes/${grilledCheese}/contest`, { enter: '1' }, nicole);
  await post(`/recipes/${tacoDip}/contest`, { enter: '1' }, nicole);
  await post(`/recipes/${lasagna}/contest`, { enter: '1' }, anthony);
  assert.match(await page(`/recipes/${grilledCheese}`, fans[0]), /This recipe is in the/);

  // Votes: two fans heart the taco dip, one hearts the grilled cheese.
  // Nicole hearting her own recipe doesn't count.
  await heart(tacoDip, fans[0]);
  await heart(tacoDip, fans[1]);
  await heart(grilledCheese, fans[0]);
  await heart(grilledCheese, nicole);
  await heart(grilledCheese, anthony);
  let contest = await page('/contest', fans[0]);
  assert.match(contest, /Current standings/);
  assert.match(contest, /Halloween Taco Dip<\/a>[\s\S]*?2 votes/);
  assert.match(contest, /Spooky Grilled Cheese<\/a>[\s\S]*?2 votes/, 'neither the creator\'s own heart nor a September heart is a vote');
  assert.ok(contest.indexOf('Spooky Grilled Cheese') < contest.indexOf('Halloween Taco Dip'), 'a tie goes to the earlier entry');

  // Leaving the contest takes the lasagna out.
  await post(`/recipes/${lasagna}/contest`, { enter: '0' }, anthony);
  assert.doesNotMatch(await page('/contest', fans[0]), /Lasagna/);

  // One more vote puts the taco dip ahead.
  const late = await signup('Late Fan', 'late@example.com');
  await heart(tacoDip, late);
  contest = await page('/contest', fans[0]);
  assert.ok(contest.indexOf('Halloween Taco Dip') < contest.indexOf('Spooky Grilled Cheese'), 'most votes first');

  // November: normal menu again, winner announced and crowned.
  clock = new Date('2026-11-02T12:00:00-05:00');
  home = await page('/', fans[0]);
  assert.doesNotMatch(home, /home spooky/);
  assert.match(home, /Spookiest Food 2026:<\/strong> Halloween Taco Dip by Nicole/);

  // Hearts after Halloween don't change the result.
  const afterParty = [await signup('After 1', 'a1@example.com'), await signup('After 2', 'a2@example.com')];
  for (const fan of afterParty) await heart(grilledCheese, fan);
  contest = await page('/contest', fans[0]);
  assert.match(contest, /Final standings/);
  assert.match(contest, /Spooky Grilled Cheese<\/a>[\s\S]*?2 votes/, 'final standings ignore hearts after Halloween');
  assert.match(contest, /Winner: Halloween Taco Dip by Nicole \(3 hearts\)/);

  assert.match(await page(`/recipes/${tacoDip}`, fans[0]), /👑 Spookiest Food 2026/);
  assert.doesNotMatch(await page(`/recipes/${grilledCheese}`, fans[0]), /👑 Spookiest Food/);
  const nicoleProfile = (await page(`/recipes/${tacoDip}`, fans[0])).match(/href="(\/users\/\d+)" class="person"/)[1];
  assert.match(await page(nicoleProfile, fans[0]), /👑 Spookiest Food 2026: Halloween Taco Dip/);
  assert.strictEqual((await post(`/recipes/${grilledCheese}/contest`, { enter: '1' }, nicole)).status, 404, 'no entering after Halloween');

  // Mid-November: the announcement comes off the main menu, the crown stays.
  clock = new Date('2026-11-20T12:00:00-05:00');
  assert.doesNotMatch(await page('/', fans[0]), /Spookiest Food 2026/);
  assert.match(await page(`/recipes/${tacoDip}`, fans[0]), /👑 Spookiest Food 2026/);
});
