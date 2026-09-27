const path = require('node:path');
const express = require('express');
const { openDb } = require('./lib/db');
const auth = require('./lib/auth');
const views = require('./lib/views');
const { AVATAR_PRESETS } = require('./lib/presets');

const COOKIE = 'ccr_session';

// Postgres returns BIGINT ids as strings; normalize so comparisons with req.user.id work.
function toRecipe(row) {
  return {
    ...row,
    id: Number(row.id),
    author_id: Number(row.author_id),
    verified: Boolean(row.verified),
    favorited: Boolean(row.favorited),
    authorPerson: {
      id: Number(row.author_id),
      name: row.author,
      avatarVersion: row.author_avatar ? Number(row.author_avatar) : null,
      preset: row.author_preset || null,
    },
  };
}

// Profile pictures arrive as data URLs made by public/app.js (a 256px square).
// Only real JPEG, PNG or WebP bytes are accepted, whatever the data URL claims.
const MAX_AVATAR_BYTES = 300 * 1024;
const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

function parseAvatar(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES || !IMAGE_SIGNATURES[match[1]](bytes)) return null;
  return { type: match[1], bytes };
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
  // Big enough for a profile picture; everything else is far smaller.
  app.use(express.urlencoded({ extended: false, limit: '600kb' }));
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

  // $1 is always the signed-in user's id, so each row says whether they favorited it.
  const recipeQuery = `
    SELECT recipes.*, to_char(recipes.created_at, 'YYYY-MM-DD') AS created_on, users.name AS author,
      ${auth.AVATAR_VERSION} AS author_avatar, users.avatar_preset AS author_preset,
      EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = recipes.id AND f.user_id = $1) AS favorited
    FROM recipes JOIN users ON users.id = recipes.author_id`;
  const recipes = async (req, rest, params = []) =>
    (await db.query(`${recipeQuery} ${rest}`, [req.user.id, ...params])).map(toRecipe);

  app.get('/', (req, res) => res.send(views.homePage({ user: req.user })));

  app.get('/recipes', async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const list = query
      ? await recipes(req, `WHERE verified
          AND (title ILIKE $2 ESCAPE '\\' OR ingredients ILIKE $2 ESCAPE '\\')
          ORDER BY recipes.id DESC`, [like])
      : await recipes(req, 'WHERE verified ORDER BY recipes.id DESC');
    const unverifiedCount = isAdmin(req.user)
      ? Number((await db.query('SELECT COUNT(*) AS n FROM recipes WHERE NOT verified'))[0].n)
      : 0;
    const [{ n: favoriteCount }] = await db.query(
      'SELECT COUNT(*) AS n FROM favorites JOIN recipes ON recipes.id = favorites.recipe_id WHERE favorites.user_id = $1 AND recipes.verified',
      [req.user.id],
    );
    res.send(views.recipesPage({
      user: req.user, isAdmin: isAdmin(req.user), recipes: list, unverifiedCount, query, favoriteCount: Number(favoriteCount),
    }));
  });

  app.get('/recipes/favorites', async (req, res) => {
    const list = await recipes(req, `JOIN favorites fav ON fav.recipe_id = recipes.id AND fav.user_id = $1
      WHERE verified ORDER BY fav.created_at DESC`);
    res.send(views.favoritesPage({ user: req.user, recipes: list }));
  });

  // Sets the heart to the state the button asked for, so double taps can't flip it back.
  app.post('/recipes/:id/favorite', async (req, res) => {
    const id = recipeId(req);
    const want = req.body.favorite === '1';
    let favorited = false;
    if (id && want) {
      // Only verified recipes can be favorited.
      await db.query(
        `INSERT INTO favorites (user_id, recipe_id)
         SELECT $1, id FROM recipes WHERE id = $2 AND verified
         ON CONFLICT DO NOTHING`,
        [req.user.id, id],
      );
      const [row] = await db.query('SELECT 1 FROM favorites WHERE user_id = $1 AND recipe_id = $2', [req.user.id, id]);
      favorited = Boolean(row);
    } else if (id) {
      await db.query('DELETE FROM favorites WHERE user_id = $1 AND recipe_id = $2', [req.user.id, id]);
    }
    if (req.get('x-requested-with') === 'fetch') return res.json({ favorited });
    const back = String(req.body.back || '');
    res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/recipes');
  });

  app.get('/recipes/mine', async (req, res) => {
    const list = await recipes(req, 'WHERE author_id = $1 ORDER BY recipes.id DESC');
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
    const list = await recipes(req, 'WHERE NOT verified ORDER BY recipes.id');
    res.send(views.unverifiedPage({ user: req.user, recipes: list }));
  });

  app.get('/recipes/:id', async (req, res) => {
    const id = recipeId(req);
    const [recipe] = id ? await recipes(req, 'WHERE recipes.id = $2', [id]) : [];
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

  // Profiles show a person's name, picture and verified recipes. Never their email.
  app.get('/users/:id', async (req, res) => {
    const id = recipeId(req);
    const [row] = id ? await db.query(
      `SELECT id, name, avatar_preset, to_char(created_at, 'FMMonth YYYY') AS joined_on, ${auth.AVATAR_VERSION} AS avatar_version
       FROM users WHERE id = $1`,
      [id],
    ) : [];
    if (!row) return res.status(404).send(views.notFoundPage({ user: req.user }));
    const person = {
      id: Number(row.id), name: row.name, joined_on: row.joined_on,
      avatarVersion: row.avatar_version ? Number(row.avatar_version) : null,
      preset: row.avatar_preset || null,
    };
    const list = await recipes(req, 'WHERE verified AND author_id = $2 ORDER BY recipes.id DESC', [person.id]);
    res.send(views.profilePage({ user: req.user, person, recipes: list, isMe: person.id === req.user.id }));
  });

  app.get('/users/:id/avatar', async (req, res) => {
    const id = recipeId(req);
    const [row] = id ? await db.query('SELECT avatar, avatar_type FROM users WHERE id = $1 AND avatar IS NOT NULL', [id]) : [];
    if (!row || !IMAGE_SIGNATURES[row.avatar_type]) return res.status(404).end();
    res.set({
      'Content-Type': row.avatar_type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    });
    res.send(Buffer.from(row.avatar));
  });

  // Change profile: only ever edits the signed-in person's own account.
  app.get('/profile', (req, res) => {
    res.send(views.editProfilePage({ user: req.user, notice: req.query.saved ? 'Your profile has been updated.' : '' }));
  });

  app.post('/profile', async (req, res) => {
    const name = String(req.body.name || '').trim();
    const fail = (error) => res.status(400).send(views.editProfilePage({ user: { ...req.user, name: name || req.user.name }, error }));
    if (!name || name.length > 60) return fail('Please enter a name up to 60 characters.');
    let picture = null;
    if (req.body.avatar) {
      picture = parseAvatar(String(req.body.avatar));
      if (!picture) return fail("That picture couldn't be used. Try a different JPEG or PNG photo.");
    }
    const preset = String(req.body.preset || '');
    if (preset && !Object.hasOwn(AVATAR_PRESETS, preset)) return fail('Please pick one of the food pictures.');
    await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
    // A person has one picture at a time: a new photo replaces a food picture and the other way round.
    if (picture) {
      await db.query(
        'UPDATE users SET avatar = $1, avatar_type = $2, avatar_updated_at = now(), avatar_preset = NULL WHERE id = $3',
        [picture.bytes, picture.type, req.user.id],
      );
    } else if (preset) {
      await db.query(
        'UPDATE users SET avatar_preset = $1, avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL WHERE id = $2',
        [preset, req.user.id],
      );
    }
    res.redirect(`/users/${req.user.id}`);
  });

  app.post('/profile/avatar/remove', async (req, res) => {
    await db.query(
      'UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL, avatar_preset = NULL WHERE id = $1',
      [req.user.id],
    );
    res.redirect('/profile?saved=1');
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
