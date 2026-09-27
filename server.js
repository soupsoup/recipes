const path = require('node:path');
const express = require('express');
const { openDb } = require('./lib/db');
const auth = require('./lib/auth');
const views = require('./lib/views');

const COOKIE = 'ccr_session';

// Postgres returns BIGINT ids as strings; normalize so comparisons with req.user.id work.
function toRecipe(row) {
  return { ...row, id: Number(row.id), author_id: Number(row.author_id), verified: Boolean(row.verified) };
}

function recipeId(req) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createApp({ db, adminEmail }) {
  const admin = (adminEmail || '').trim().toLowerCase();
  const isAdmin = (user) => Boolean(admin) && user?.email === admin;

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(async (req, res, next) => {
    req.user = await auth.userForSession(db, auth.readCookie(req, COOKIE));
    next();
  });

  async function startSession(req, res, userId) {
    const { token, maxAge } = await auth.createSession(db, userId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge });
  }

  // Sign in / sign up are the only pages open to signed-out visitors.
  app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.send(views.authPage({ mode: 'login' }))));
  app.get('/signup', (req, res) => (req.user ? res.redirect('/') : res.send(views.authPage({ mode: 'signup' }))));

  app.post('/signup', async (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const fail = (error) => res.status(400).send(views.authPage({ mode: 'signup', error, values: { name, email } }));
    if (!name || !email) return fail('Please fill in your name and email.');
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    const [user] = await db.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [name, email, auth.hashPassword(password)],
    );
    if (!user) return fail('That email already has an account.');
    await startSession(req, res, Number(user.id));
    res.redirect('/');
  });

  app.post('/login', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const [user] = await db.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    if (!user || !auth.checkPassword(req.body.password || '', user.password_hash)) {
      return res.status(401).send(views.authPage({ mode: 'login', error: 'Wrong email or password.', values: { email } }));
    }
    await startSession(req, res, Number(user.id));
    res.redirect('/');
  });

  app.post('/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token = $1', [auth.readCookie(req, COOKIE) || '']);
    res.clearCookie(COOKIE);
    res.redirect('/login');
  });

  // Everything below needs a signed-in user.
  app.use((req, res, next) => (req.user ? next() : res.redirect('/login')));

  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(404).send(views.notFoundPage({ user: req.user })));

  const recipeQuery = `
    SELECT recipes.*, to_char(recipes.created_at, 'YYYY-MM-DD') AS created_on, users.name AS author
    FROM recipes JOIN users ON users.id = recipes.author_id`;
  const recipes = async (where, params = []) => (await db.query(`${recipeQuery} ${where}`, params)).map(toRecipe);

  app.get('/', (req, res) => res.send(views.homePage({ user: req.user })));

  app.get('/recipes', async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const list = query
      ? await recipes(`WHERE verified
          AND (title ILIKE $1 ESCAPE '\\' OR ingredients ILIKE $1 ESCAPE '\\')
          ORDER BY recipes.id DESC`, [like])
      : await recipes('WHERE verified ORDER BY recipes.id DESC');
    const unverifiedCount = isAdmin(req.user)
      ? Number((await db.query('SELECT COUNT(*) AS n FROM recipes WHERE NOT verified'))[0].n)
      : 0;
    res.send(views.recipesPage({ user: req.user, isAdmin: isAdmin(req.user), recipes: list, unverifiedCount, query }));
  });

  app.get('/recipes/mine', async (req, res) => {
    const list = await recipes('WHERE author_id = $1 ORDER BY recipes.id DESC', [req.user.id]);
    const notice = req.query.submitted ? 'Thanks! Your recipe will show up in Recipes once it has been verified.' : '';
    res.send(views.myRecipesPage({ user: req.user, recipes: list, notice }));
  });

  app.get('/recipes/new', (req, res) => res.send(views.newRecipePage({ user: req.user })));

  app.post('/recipes', async (req, res) => {
    const values = {
      title: (req.body.title || '').trim(),
      ingredients: (req.body.ingredients || '').trim(),
      steps: (req.body.steps || '').trim(),
    };
    if (!values.title || !values.ingredients || !values.steps) {
      return res.status(400).send(views.newRecipePage({ user: req.user, error: 'Please fill in every field.', values }));
    }
    await db.query(
      'INSERT INTO recipes (title, ingredients, steps, author_id) VALUES ($1, $2, $3, $4)',
      [values.title, values.ingredients, values.steps, req.user.id],
    );
    res.redirect('/recipes/mine?submitted=1');
  });

  app.get('/recipes/unverified', requireAdmin, async (req, res) => {
    const list = await recipes('WHERE NOT verified ORDER BY recipes.id');
    res.send(views.unverifiedPage({ user: req.user, recipes: list }));
  });

  app.get('/recipes/:id', async (req, res) => {
    const id = recipeId(req);
    const [recipe] = id ? await recipes('WHERE recipes.id = $1', [id]) : [];
    // Unverified recipes are visible only to the admin and the person who wrote them.
    const canSee = recipe && (recipe.verified || isAdmin(req.user) || recipe.author_id === req.user.id);
    if (!canSee) return res.status(404).send(views.notFoundPage({ user: req.user }));
    res.send(views.recipePage({ user: req.user, isAdmin: isAdmin(req.user), recipe }));
  });

  app.post('/recipes/:id/verify', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    if (id) await db.query('UPDATE recipes SET verified = true WHERE id = $1', [id]);
    res.redirect('/recipes/unverified');
  });

  app.post('/recipes/:id/delete', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    if (id) await db.query('DELETE FROM recipes WHERE id = $1', [id]);
    res.redirect('/recipes/unverified');
  });

  app.use((req, res) => res.status(404).send(views.notFoundPage({ user: req.user })));

  return app;
}

// Settings come from environment variables: DATABASE_URL (Postgres, e.g. Supabase)
// and ADMIN_EMAIL. Without DATABASE_URL the app keeps its data in data/pglite.
function appFromEnv() {
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add the Supabase connection string in the Vercel project settings.');
  }
  if (!process.env.ADMIN_EMAIL) {
    console.warn('ADMIN_EMAIL is not set, so nobody can see or verify unverified recipes.');
  }
  const db = openDb({
    databaseUrl: process.env.DATABASE_URL,
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data', 'pglite'),
  });
  return createApp({ db, adminEmail: process.env.ADMIN_EMAIL });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  appFromEnv().listen(port, () => console.log(`Cool Cooking Recipes running at http://localhost:${port}`));
}

module.exports = { createApp, appFromEnv };
