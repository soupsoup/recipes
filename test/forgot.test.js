const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { openDb } = require('../lib/db');

let server;
let base;
let clock = new Date('2026-11-27T12:00:00Z');
const messages = [];

before(async () => {
  const app = createApp({
    db: openDb(),
    adminEmail: 'admin@example.com',
    now: () => clock,
    notify: async (text) => { messages.push(text); },
  });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const post = (path, fields, cookie) => fetch(base + path, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie && { cookie }) },
  body: new URLSearchParams(fields),
});
const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test('sign-in page links to the forgot password form', async () => {
  const html = await (await get('/login')).text();
  assert.match(html, /href="\/forgot"/);
  const res = await get('/forgot');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /action="\/forgot"/);
});

test('a request pings the admin with a link to the reset page, once per cooldown', async () => {
  await post('/signup', { name: 'Luca [click](http://evil)', email: 'luca@example.com', password: 'password123' });
  messages.length = 0;

  const res = await post('/forgot', { email: ' Luca@Example.com ' });
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Request sent/);
  await settle();
  assert.strictEqual(messages.length, 1);
  assert.match(messages[0], /luca@example\.com/);
  assert.match(messages[0], /\/admin\/reset\?email=luca%40example\.com/);
  assert.doesNotMatch(messages[0], /\[click\]\(/, 'names cannot inject chat links');

  await post('/forgot', { email: 'luca@example.com' });
  await settle();
  assert.strictEqual(messages.length, 1, 'repeat requests inside the cooldown stay quiet');

  clock = new Date(clock.getTime() + 16 * 60 * 1000);
  await post('/forgot', { email: 'luca@example.com' });
  await settle();
  assert.strictEqual(messages.length, 2, 'a new request after the cooldown pings again');
});

test('unknown emails get the same answer and no ping', async () => {
  clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
  messages.length = 0;
  const res = await post('/forgot', { email: 'nobody@example.com' });
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Request sent/);
  await settle();
  assert.strictEqual(messages.length, 0);
});

test('one address can only ask a few times an hour', async () => {
  clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
  for (let i = 0; i < 6; i += 1) {
    await post('/signup', { name: `Kid ${i}`, email: `kid${i}@example.com`, password: 'password123' });
  }
  messages.length = 0;
  for (let i = 0; i < 6; i += 1) await post('/forgot', { email: `kid${i}@example.com` });
  await settle();
  assert.strictEqual(messages.length, 5);
});

test('the admin reset page comes filled in from the chat link', async () => {
  await post('/signup', { name: 'Admin', email: 'admin@example.com', password: 'password123' });
  const login = await post('/login', { email: 'admin@example.com', password: 'password123' });
  const admin = login.headers.get('set-cookie').split(';')[0];
  const html = await (await get('/admin/reset?email=luca%40example.com', admin)).text();
  assert.match(html, /name="email" required value="luca@example\.com"/);
});
