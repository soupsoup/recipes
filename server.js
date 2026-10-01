const path = require('node:path');
const express = require('express');
const { openDb } = require('./lib/db');
const auth = require('./lib/auth');
const views = require('./lib/views');
const { AVATAR_PRESETS } = require('./lib/presets');
const { halloween, contestStart, contestEnd } = require('./lib/halloween');
const { parseVideo } = require('./lib/video');

const COOKIE = 'ccr_session';

// Postgres returns BIGINT ids as strings; normalize so comparisons with req.user.id work.
function toRecipe(row) {
  return {
    ...row,
    id: Number(row.id),
    author_id: Number(row.author_id),
    verified: Boolean(row.verified),
    favorited: Boolean(row.favorited),
    photoVersion: row.photo_version ? Number(row.photo_version) : null,
    commentsOff: Boolean(row.comments_off),
    video: row.video_url ? parseVideo(row.video_url) : null,
    authorPerson: {
      id: Number(row.author_id),
      name: row.author,
      avatarVersion: row.author_avatar ? Number(row.author_avatar) : null,
      preset: row.author_preset || null,
    },
  };
}

// Pictures arrive as data URLs made by public/app.js: a 256px square for profiles,
// at most 1000px wide for recipe photos. Only real JPEG, PNG or WebP bytes are
// accepted, whatever the data URL claims.
const MAX_AVATAR_BYTES = 300 * 1024;
const MAX_PHOTO_BYTES = 600 * 1024;
const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

function parseImage(dataUrl, maxBytes) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes || !IMAGE_SIGNATURES[match[1]](bytes)) return null;
  return { type: match[1], bytes };
}

function sendImage(req, res, bytes, type) {
  res.set({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  });
  res.send(Buffer.from(bytes));
}

function recipeId(req) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// `now` can be swapped in tests to pretend it's October.
function createApp({ db, adminEmail, now = () => new Date() }) {
  const admin = (adminEmail || '').trim().toLowerCase();
  const isAdmin = (user) => Boolean(admin) && user?.email === admin;

  const app = express();
  app.set('trust proxy', 1);
  // Big enough for a recipe photo; everything else is far smaller.
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
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
    SELECT recipes.id, recipes.title, recipes.ingredients, recipes.steps, recipes.author_id, recipes.verified,
      recipes.comments_off, recipes.video_url,
      to_char(recipes.created_at, 'YYYY-MM-DD') AS created_on, users.name AS author,
      CASE WHEN recipes.photo IS NULL THEN NULL
        ELSE floor(extract(epoch FROM recipes.photo_updated_at) * 1000)::bigint END AS photo_version,
      ${auth.AVATAR_VERSION} AS author_avatar, users.avatar_preset AS author_preset,
      EXISTS (SELECT 1 FROM favorites f WHERE f.recipe_id = recipes.id AND f.user_id = $1) AS favorited
    FROM recipes JOIN users ON users.id = recipes.author_id`;
  const recipes = async (req, rest, params = []) =>
    (await db.query(`${recipeQuery} ${rest}`, [req.user.id, ...params])).map(toRecipe);

  // ---- Spooky Food Contest ----------------------------------------------------
  // Votes are hearts from anyone except the recipe's own creator, given during October
  // ($3 is the start, $2 the end). The winner is saved once so later hearts can't change it.
  const contestVotes = `
    SELECT e.recipe_id, e.created_at AS entered_at,
      count(f.user_id) FILTER (WHERE f.user_id <> r.author_id AND f.created_at >= $3 AND f.created_at < $2) AS votes
    FROM contest_entries e
    JOIN recipes r ON r.id = e.recipe_id AND r.verified
    LEFT JOIN favorites f ON f.recipe_id = e.recipe_id
    WHERE e.year = $1
    GROUP BY e.recipe_id, e.created_at`;

  async function decideWinner(year) {
    const [done] = await db.query('SELECT 1 FROM contest_winners WHERE year = $1', [year]);
    if (done) return;
    await db.query(
      `INSERT INTO contest_winners (year, recipe_id, hearts)
       SELECT $1, recipe_id, votes FROM (${contestVotes}) v
       WHERE votes > 0 ORDER BY votes DESC, entered_at ASC, recipe_id ASC LIMIT 1
       ON CONFLICT (year) DO NOTHING`,
      [year, contestEnd(year), contestStart(year)],
    );
    // No entries with votes: remember that nobody won, so this isn't worked out again.
    await db.query('INSERT INTO contest_winners (year, recipe_id, hearts) VALUES ($1, NULL, 0) ON CONFLICT (year) DO NOTHING', [year]);
  }

  async function winnerOf(year) {
    await decideWinner(year);
    const [row] = await db.query(
      `SELECT w.year, w.hearts, r.id, r.title, u.id AS author_id, u.name AS author
       FROM contest_winners w JOIN recipes r ON r.id = w.recipe_id JOIN users u ON u.id = r.author_id
       WHERE w.year = $1 AND r.verified`,
      [year],
    );
    return row ? { year: Number(row.year), hearts: Number(row.hearts), recipeId: Number(row.id), title: row.title, authorId: Number(row.author_id), author: row.author } : null;
  }

  async function crownsFor(where, params) {
    await decideWinner(halloween(now()).lastEndedYear);
    return (await db.query(
      `SELECT w.year, r.id, r.title FROM contest_winners w JOIN recipes r ON r.id = w.recipe_id
       WHERE ${where} AND r.verified ORDER BY w.year DESC`,
      params,
    )).map((c) => ({ year: Number(c.year), recipeId: Number(c.id), title: c.title }));
  }

  app.get('/', async (req, res) => {
    const h = halloween(now());
    const winner = h.announcing ? await winnerOf(h.lastEndedYear) : null;
    res.send(views.homePage({ user: req.user, spooky: h.spooky, contestYear: h.year, winner }));
  });

  app.get('/contest', async (req, res) => {
    const h = halloween(now());
    const year = h.contestOpen ? h.year : h.lastEndedYear;
    const winner = h.contestOpen ? null : await winnerOf(year);
    const votes = await db.query(`${contestVotes} ORDER BY votes DESC, entered_at ASC, e.recipe_id ASC`, [year, contestEnd(year), contestStart(year)]);
    const entries = [];
    for (const v of votes) {
      const [recipe] = await recipes(req, 'WHERE recipes.id = $2', [Number(v.recipe_id)]);
      if (recipe) entries.push({ ...recipe, votes: Number(v.votes) });
    }
    res.send(views.contestPage({ user: req.user, year, open: h.contestOpen, entries, winner }));
  });

  // The creator of a verified recipe can enter it (or take it out) during October.
  app.post('/recipes/:id/contest', async (req, res) => {
    const id = recipeId(req);
    const h = halloween(now());
    const [recipe] = id ? await db.query('SELECT id FROM recipes WHERE id = $1 AND author_id = $2 AND verified', [id, req.user.id]) : [];
    if (!recipe || !h.contestOpen) return res.status(404).send(views.notFoundPage({ user: req.user }));
    if (req.body.enter === '1') {
      await db.query(
        'INSERT INTO contest_entries (recipe_id, year, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, h.year, now()],
      );
    } else {
      await db.query('DELETE FROM contest_entries WHERE recipe_id = $1 AND year = $2', [id, h.year]);
    }
    res.redirect(`/recipes/${id}`);
  });

  // ---- Sections (Burgers, Chicken, ...) ----------------------------------------
  // The admin creates sections and puts recipes in them; everyone can browse them.
  async function allSections() {
    return (await db.query(
      `SELECT s.id, s.name, s.emoji,
         count(r.id) AS recipe_count
       FROM sections s
       LEFT JOIN recipe_sections rs ON rs.section_id = s.id
       LEFT JOIN recipes r ON r.id = rs.recipe_id AND r.verified
       GROUP BY s.id ORDER BY s.position, s.id`,
    )).map((x) => ({ id: Number(x.id), name: x.name, emoji: x.emoji, count: Number(x.recipe_count) }));
  }

  function sectionInput(body) {
    return {
      name: String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      // A short emoji (or nothing); the length cap keeps it to an icon, not a sentence.
      emoji: [...String(body.emoji || '').trim()].slice(0, 4).join(''),
    };
  }

  app.get('/recipes', async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const sections = await allSections();
    const section = sections.find((x) => x.id === Number(req.query.section)) || null;
    const where = ['verified'];
    const params = [];
    if (query) {
      params.push(like);
      where.push(`(title ILIKE $${params.length + 1} ESCAPE '\\' OR ingredients ILIKE $${params.length + 1} ESCAPE '\\')`);
    }
    if (section) {
      params.push(section.id);
      where.push(`EXISTS (SELECT 1 FROM recipe_sections rs WHERE rs.recipe_id = recipes.id AND rs.section_id = $${params.length + 1})`);
    }
    const list = await recipes(req, `WHERE ${where.join(' AND ')} ORDER BY recipes.id DESC`, params);
    const unverifiedCount = isAdmin(req.user)
      ? Number((await db.query('SELECT COUNT(*) AS n FROM recipes WHERE NOT verified'))[0].n)
      : 0;
    const [{ n: favoriteCount }] = await db.query(
      'SELECT COUNT(*) AS n FROM favorites JOIN recipes ON recipes.id = favorites.recipe_id WHERE favorites.user_id = $1 AND recipes.verified',
      [req.user.id],
    );
    const notice = req.query.deleted && isAdmin(req.user) ? `Deleted "${String(req.query.deleted).slice(0, 100)}".` : '';
    res.send(views.recipesPage({
      user: req.user, isAdmin: isAdmin(req.user), recipes: list, unverifiedCount, query, favoriteCount: Number(favoriteCount), notice,
      sections, section,
    }));
  });

  app.get('/sections', requireAdmin, async (req, res) => {
    res.send(views.sectionsPage({ user: req.user, sections: await allSections(), notice: String(req.query.notice || '').slice(0, 100) }));
  });

  app.post('/sections', requireAdmin, async (req, res) => {
    const { name, emoji } = sectionInput(req.body);
    const fail = async (error) => res.status(400).send(views.sectionsPage({ user: req.user, sections: await allSections(), error, values: { name, emoji } }));
    if (!name) return fail('Give the new section a name.');
    const [made] = await db.query(
      `INSERT INTO sections (name, emoji, position)
       VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM sections))
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name, emoji],
    );
    if (!made) return fail(`There's already a section called "${name}".`);
    res.redirect(`/sections?notice=${encodeURIComponent(`Added ${name}.`)}`);
  });

  app.post('/sections/:id', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    const { name, emoji } = sectionInput(req.body);
    if (!id || !name) return res.redirect('/sections');
    const clash = await db.query('SELECT 1 FROM sections WHERE name = $1 AND id <> $2', [name, id]);
    if (clash.length) {
      return res.status(400).send(views.sectionsPage({ user: req.user, sections: await allSections(), error: `There's already a section called "${name}".` }));
    }
    await db.query('UPDATE sections SET name = $1, emoji = $2 WHERE id = $3', [name, emoji, id]);
    res.redirect(`/sections?notice=${encodeURIComponent(`Saved ${name}.`)}`);
  });

  // Deleting a section only removes the section; its recipes stay in Recipes.
  app.post('/sections/:id/delete', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    const [gone] = id ? await db.query('DELETE FROM sections WHERE id = $1 RETURNING name', [id]) : [];
    res.redirect(`/sections?notice=${encodeURIComponent(gone ? `Deleted the ${gone.name} section.` : '')}`);
  });

  app.post('/recipes/:id/sections', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    const [recipe] = id ? await db.query('SELECT id FROM recipes WHERE id = $1', [id]) : [];
    if (!recipe) return res.status(404).send(views.notFoundPage({ user: req.user }));
    const picked = [].concat(req.body.section_ids || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    await db.query('DELETE FROM recipe_sections WHERE recipe_id = $1', [id]);
    for (const sectionId of new Set(picked)) {
      // Only sections that exist; anything else is ignored.
      await db.query(
        'INSERT INTO recipe_sections (recipe_id, section_id) SELECT $1, id FROM sections WHERE id = $2 ON CONFLICT DO NOTHING',
        [id, sectionId],
      );
    }
    res.redirect(`/recipes/${id}?sections=saved#sections`);
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
        `INSERT INTO favorites (user_id, recipe_id, created_at)
         SELECT $1, id, $3 FROM recipes WHERE id = $2 AND verified
         ON CONFLICT DO NOTHING`,
        [req.user.id, id, now()],
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
      photo: String(req.body.photo || ''),
      video_url: String(req.body.video_url || '').trim(),
    };
    const fail = (error) => res.status(400).send(views.newRecipePage({ user: req.user, error, values }));
    if (!values.title || !values.ingredients || !values.steps) return fail('Please fill in every field.');
    const video = values.video_url ? parseVideo(values.video_url) : null;
    if (values.video_url && !video) return fail('That video link didn\'t work. Paste a link to an Instagram post or reel, or a YouTube video.');
    // The photo is optional, and goes through verification along with the rest of the recipe.
    const photo = values.photo ? parseImage(values.photo, MAX_PHOTO_BYTES) : null;
    if (values.photo && !photo) {
      values.photo = '';
      return fail("That photo couldn't be used. Try a different JPEG or PNG photo.");
    }
    await db.query(
      `INSERT INTO recipes (title, ingredients, steps, author_id, photo, photo_type, photo_updated_at, video_url)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5::bytea IS NULL THEN NULL ELSE now() END, $7)`,
      [values.title, values.ingredients, values.steps, req.user.id, photo?.bytes ?? null, photo?.type ?? null, video?.link ?? null],
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
    const notice = req.query.edited
      ? (recipe.verified ? 'Your changes are saved.' : 'Your changes are saved. They will show in Recipes once they have been verified.')
      : '';
    const openThread = Number(req.query.thread) || null;
    // When the creator turns comments off they are hidden, not deleted.
    const comments = recipe.verified && !recipe.commentsOff ? (await db.query(
      `SELECT comments.id, comments.parent_id, comments.user_id, comments.body,
         extract(epoch FROM now() - comments.created_at) AS age_seconds,
         users.name, users.avatar_preset, ${auth.AVATAR_VERSION} AS avatar_version
       FROM comments JOIN users ON users.id = comments.user_id
       WHERE comments.recipe_id = $1
       -- Newest comments first; replies oldest first under their comment, like YouTube.
       ORDER BY CASE WHEN comments.parent_id IS NULL THEN comments.created_at END DESC NULLS LAST,
                comments.created_at ASC`,
      [recipe.id],
    )).map((c) => ({
      id: Number(c.id),
      parent_id: c.parent_id ? Number(c.parent_id) : null,
      user_id: Number(c.user_id),
      body: c.body,
      age_seconds: Number(c.age_seconds),
      open: c.parent_id && Number(c.parent_id) === openThread,
      author: {
        id: Number(c.user_id), name: c.name, preset: c.avatar_preset,
        avatarVersion: c.avatar_version ? Number(c.avatar_version) : null,
      },
    })) : [];
    const canModerate = isAdmin(req.user) || recipe.author_id === req.user.id;
    const h = halloween(now());
    const [entry] = await db.query('SELECT 1 FROM contest_entries WHERE recipe_id = $1 AND year = $2', [recipe.id, h.year]);
    const contest = {
      open: h.contestOpen && recipe.verified,
      entered: Boolean(entry) && h.contestOpen,
      crowns: await crownsFor('r.id = $1', [recipe.id]),
    };
    const inSections = new Set((await db.query('SELECT section_id FROM recipe_sections WHERE recipe_id = $1', [recipe.id]))
      .map((r) => Number(r.section_id)));
    const sections = (await allSections()).map((x) => ({ ...x, checked: inSections.has(x.id) }));
    const sectionNotice = req.query.sections === 'saved' ? 'Sections saved.' : '';
    res.send(views.recipePage({
      user: req.user, isAdmin: isAdmin(req.user), recipe, notice: notice || sectionNotice, comments, canModerate, contest, sections,
    }));
  });

  // Comments and replies: anyone signed in can comment on a verified recipe.
  app.post('/recipes/:id/comments', async (req, res) => {
    const id = recipeId(req);
    const [recipe] = id ? await db.query('SELECT id, comments_off FROM recipes WHERE id = $1 AND verified', [id]) : [];
    if (!recipe) return res.status(404).send(views.notFoundPage({ user: req.user }));
    if (recipe.comments_off) return res.redirect(`/recipes/${id}#comments`);
    const body = String(req.body.body || '').trim().slice(0, 1000);
    if (!body) return res.redirect(`/recipes/${id}#comments`);
    let parentId = null;
    if (req.body.parent_id) {
      // Replies must belong to a top-level comment on this same recipe.
      const [parent] = await db.query(
        'SELECT id FROM comments WHERE id = $1 AND recipe_id = $2 AND parent_id IS NULL',
        [Number(req.body.parent_id) || 0, id],
      );
      if (!parent) return res.redirect(`/recipes/${id}#comments`);
      parentId = Number(parent.id);
    }
    const [comment] = await db.query(
      'INSERT INTO comments (recipe_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, req.user.id, parentId, body],
    );
    res.redirect(`/recipes/${id}${parentId ? `?thread=${parentId}` : ''}#comment-${comment.id}`);
  });

  // Only the recipe's creator can turn its comments off or back on.
  app.post('/recipes/:id/comments/toggle', async (req, res) => {
    const id = recipeId(req);
    const [row] = id ? await db.query(
      'UPDATE recipes SET comments_off = $1 WHERE id = $2 AND author_id = $3 RETURNING id',
      [req.body.off === '1', id, req.user.id],
    ) : [];
    if (!row) return res.status(404).send(views.notFoundPage({ user: req.user }));
    res.redirect(`/recipes/${id}#comments`);
  });

  // The commenter, the recipe's author or the admin can delete a comment (and its replies).
  app.post('/comments/:id/delete', async (req, res) => {
    const id = recipeId(req);
    const [comment] = id ? await db.query(
      `SELECT comments.id, comments.user_id, comments.recipe_id, comments.parent_id, recipes.author_id
       FROM comments JOIN recipes ON recipes.id = comments.recipe_id WHERE comments.id = $1`,
      [id],
    ) : [];
    if (!comment) return res.status(404).send(views.notFoundPage({ user: req.user }));
    const allowed = Number(comment.user_id) === req.user.id || Number(comment.author_id) === req.user.id || isAdmin(req.user);
    if (!allowed) return res.status(404).send(views.notFoundPage({ user: req.user }));
    await db.query('DELETE FROM comments WHERE id = $1', [id]);
    const thread = comment.parent_id ? `?thread=${Number(comment.parent_id)}` : '';
    res.redirect(`/recipes/${Number(comment.recipe_id)}${thread}#comments`);
  });

  // Editing: the person who wrote the recipe, or the admin for any published recipe.
  // A verified recipe goes back to be verified after an author's edit, so changes are
  // reviewed too; the admin's edits stay published.
  async function editableRecipe(req) {
    const id = recipeId(req);
    const [recipe] = id ? await recipes(req, 'WHERE recipes.id = $2', [id]) : [];
    if (!recipe) return null;
    return recipe.author_id === req.user.id || (isAdmin(req.user) && recipe.verified) ? recipe : null;
  }

  const formExtras = (req, recipe) => ({
    sendsBackToReview: recipe.verified && !isAdmin(req.user),
    editingFor: recipe.author_id === req.user.id ? null : recipe.author,
  });

  app.get('/recipes/:id/edit', async (req, res) => {
    const recipe = await editableRecipe(req);
    if (!recipe) return res.status(404).send(views.notFoundPage({ user: req.user }));
    res.send(views.recipeFormPage({
      user: req.user, recipe, values: { ...recipe, video_url: recipe.video?.link ?? '' }, ...formExtras(req, recipe),
    }));
  });

  app.post('/recipes/:id/edit', async (req, res) => {
    const recipe = await editableRecipe(req);
    if (!recipe) return res.status(404).send(views.notFoundPage({ user: req.user }));
    const values = {
      title: (req.body.title || '').trim(),
      ingredients: (req.body.ingredients || '').trim(),
      steps: (req.body.steps || '').trim(),
      photo: String(req.body.photo || ''),
      remove_photo: req.body.remove_photo === '1' ? '1' : '0',
      video_url: String(req.body.video_url || '').trim(),
    };
    const keepVerified = recipe.verified && isAdmin(req.user);
    const fail = (error) => res.status(400).send(views.recipeFormPage({
      user: req.user, recipe, values, error, ...formExtras(req, recipe),
    }));
    if (!values.title || !values.ingredients || !values.steps) return fail('Please fill in every field.');
    const video = values.video_url ? parseVideo(values.video_url) : null;
    if (values.video_url && !video) return fail('That video link didn\'t work. Paste a link to an Instagram post or reel, or a YouTube video.');
    const photo = values.photo ? parseImage(values.photo, MAX_PHOTO_BYTES) : null;
    if (values.photo && !photo) {
      values.photo = '';
      return fail("That photo couldn't be used. Try a different JPEG or PNG photo.");
    }
    await db.query(
      // editableRecipe() above already checked who may edit this recipe.
      'UPDATE recipes SET title = $1, ingredients = $2, steps = $3, verified = $4, video_url = $5 WHERE id = $6',
      [values.title, values.ingredients, values.steps, keepVerified, video?.link ?? null, recipe.id],
    );
    if (photo) {
      await db.query(
        'UPDATE recipes SET photo = $1, photo_type = $2, photo_updated_at = now() WHERE id = $3',
        [photo.bytes, photo.type, recipe.id],
      );
    } else if (values.remove_photo === '1') {
      await db.query('UPDATE recipes SET photo = NULL, photo_type = NULL, photo_updated_at = NULL WHERE id = $1', [recipe.id]);
    }
    res.redirect(`/recipes/${recipe.id}?edited=1`);
  });

  // Same visibility rule as the recipe page itself.
  app.get('/recipes/:id/photo', async (req, res) => {
    const id = recipeId(req);
    const [row] = id ? await db.query(
      'SELECT photo, photo_type, verified, author_id FROM recipes WHERE id = $1 AND photo IS NOT NULL',
      [id],
    ) : [];
    const canSee = row && (row.verified || isAdmin(req.user) || Number(row.author_id) === req.user.id);
    if (!canSee || !IMAGE_SIGNATURES[row.photo_type]) return res.status(404).end();
    sendImage(req, res, row.photo, row.photo_type);
  });

  app.post('/recipes/:id/verify', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    if (id) await db.query('UPDATE recipes SET verified = true WHERE id = $1', [id]);
    res.redirect('/recipes/unverified');
  });

  // The admin can delete any recipe: one waiting for review, or one already published.
  app.post('/recipes/:id/delete', requireAdmin, async (req, res) => {
    const id = recipeId(req);
    const [gone] = id ? await db.query('DELETE FROM recipes WHERE id = $1 RETURNING verified, title', [id]) : [];
    if (gone?.verified) return res.redirect(`/recipes?deleted=${encodeURIComponent(gone.title)}`);
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
    const crowns = await crownsFor('r.author_id = $1', [person.id]);
    res.send(views.profilePage({ user: req.user, person, recipes: list, isMe: person.id === req.user.id, crowns }));
  });

  app.get('/users/:id/avatar', async (req, res) => {
    const id = recipeId(req);
    const [row] = id ? await db.query('SELECT avatar, avatar_type FROM users WHERE id = $1 AND avatar IS NOT NULL', [id]) : [];
    if (!row || !IMAGE_SIGNATURES[row.avatar_type]) return res.status(404).end();
    sendImage(req, res, row.avatar, row.avatar_type);
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
      picture = parseImage(String(req.body.avatar), MAX_AVATAR_BYTES);
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
  // SPOOKY_PREVIEW_DATE (e.g. 2026-10-15) lets you preview the Halloween event locally.
  const preview = process.env.SPOOKY_PREVIEW_DATE ? new Date(`${process.env.SPOOKY_PREVIEW_DATE}T12:00:00-04:00`) : null;
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
  return createApp({ db, adminEmail: process.env.ADMIN_EMAIL, now: preview ? () => preview : undefined });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  appFromEnv().listen(port, () => console.log(`Cool Cooking Recipes running at http://localhost:${port}`));
}

module.exports = { createApp, appFromEnv };
