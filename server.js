const path = require('node:path');
const express = require('express');
const { openDb } = require('./lib/db');
const auth = require('./lib/auth');
const views = require('./lib/views');

const COOKIE = 'ccr_session';

function createApp({ dbFile, adminEmail }) {
  const db = openDb(dbFile);
  const admin = (adminEmail || '').trim().toLowerCase();
  const isAdmin = (user) => Boolean(admin) && user?.email === admin;

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use((req, res, next) => {
    req.user = auth.userForSession(db, auth.readCookie(req, COOKIE));
    next();
  });

  function startSession(req, res, userId) {
    const { token, maxAge } = auth.createSession(db, userId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge });
  }

  // Sign in / sign up are the only pages open to signed-out visitors.
  app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.send(views.authPage({ mode: 'login' }))));
  app.get('/signup', (req, res) => (req.user ? res.redirect('/') : res.send(views.authPage({ mode: 'signup' }))));

  app.post('/signup', (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const fail = (error) => res.status(400).send(views.authPage({ mode: 'signup', error, values: { name, email } }));
    if (!name || !email) return fail('Please fill in your name and email.');
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('That email already has an account.');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, auth.hashPassword(password));
    startSession(req, res, Number(lastInsertRowid));
    res.redirect('/');
  });

  app.post('/login', (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!user || !auth.checkPassword(req.body.password || '', user.password_hash)) {
      return res.status(401).send(views.authPage({ mode: 'login', error: 'Wrong email or password.', values: { email } }));
    }
    startSession(req, res, user.id);
    res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.readCookie(req, COOKIE));
    res.clearCookie(COOKIE);
    res.redirect('/login');
  });

  // Everything below needs a signed-in user.
  app.use((req, res, next) => (req.user ? next() : res.redirect('/login')));

  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(404).send(views.notFoundPage({ user: req.user })));

  const recipeQuery = `
    SELECT recipes.*, users.name AS author FROM recipes
    JOIN users ON users.id = recipes.author_id`;

  app.get('/', (req, res) => res.send(views.homePage({ user: req.user })));

  app.get('/recipes', (req, res) => {
    const recipes = db.prepare(`${recipeQuery} WHERE verified = 1 ORDER BY recipes.id DESC`).all();
    const unverifiedCount = isAdmin(req.user)
      ? db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE verified = 0').get().n
      : 0;
    const notice = req.query.submitted ? 'Thanks! Your recipe will show up here once it has been verified.' : '';
    res.send(views.recipesPage({ user: req.user, isAdmin: isAdmin(req.user), recipes, unverifiedCount, notice }));
  });

  app.get('/recipes/new', (req, res) => res.send(views.newRecipePage({ user: req.user })));

  app.post('/recipes', (req, res) => {
    const values = {
      title: (req.body.title || '').trim(),
      ingredients: (req.body.ingredients || '').trim(),
      steps: (req.body.steps || '').trim(),
    };
    if (!values.title || !values.ingredients || !values.steps) {
      return res.status(400).send(views.newRecipePage({ user: req.user, error: 'Please fill in every field.', values }));
    }
    db.prepare('INSERT INTO recipes (title, ingredients, steps, author_id) VALUES (?, ?, ?, ?)')
      .run(values.title, values.ingredients, values.steps, req.user.id);
    res.redirect('/recipes?submitted=1');
  });

  app.get('/recipes/unverified', requireAdmin, (req, res) => {
    const recipes = db.prepare(`${recipeQuery} WHERE verified = 0 ORDER BY recipes.id`).all();
    res.send(views.unverifiedPage({ user: req.user, recipes }));
  });

  app.get('/recipes/:id', (req, res) => {
    const recipe = db.prepare(`${recipeQuery} WHERE recipes.id = ?`).get(Number(req.params.id));
    // Unverified recipes are visible only to the admin and the person who wrote them.
    const canSee = recipe && (recipe.verified || isAdmin(req.user) || recipe.author_id === req.user.id);
    if (!canSee) return res.status(404).send(views.notFoundPage({ user: req.user }));
    res.send(views.recipePage({ user: req.user, isAdmin: isAdmin(req.user), recipe }));
  });

  app.post('/recipes/:id/verify', requireAdmin, (req, res) => {
    db.prepare('UPDATE recipes SET verified = 1 WHERE id = ?').run(Number(req.params.id));
    res.redirect('/recipes/unverified');
  });

  app.post('/recipes/:id/delete', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM recipes WHERE id = ?').run(Number(req.params.id));
    res.redirect('/recipes/unverified');
  });

  app.use((req, res) => res.status(404).send(views.notFoundPage({ user: req.user })));

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  if (!process.env.ADMIN_EMAIL) {
    console.warn('ADMIN_EMAIL is not set, so nobody can see or verify unverified recipes.');
  }
  const app = createApp({
    dbFile: process.env.DB_FILE || path.join(__dirname, 'data', 'recipes.db'),
    adminEmail: process.env.ADMIN_EMAIL,
  });
  app.listen(port, () => console.log(`Cool Cooking Recipes running at http://localhost:${port}`));
}

module.exports = { createApp };
