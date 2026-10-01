const { AVATAR_PRESETS } = require('./presets');
const { halloween } = require('./halloween');

let clock = () => new Date();
function setClock(fn) {
  clock = fn;
}

// Header decorations for the seasonal events; they sit behind the logo and never catch taps.
const SPIDERS = [[6, 26, 3.2], [23, 14, 4.1], [41, 34, 3.6], [62, 18, 4.4], [81, 30, 3.9]];
function headerDecor(season) {
  if (season === 'halloween') {
    return `<div class="header-decor" aria-hidden="true">
      <span class="web left">🕸️</span><span class="web right">🕸️</span>
      ${SPIDERS.map(([left, drop, seconds], i) => `<span class="spider s${i + 1}" style="--left:${left}%;--drop:${drop}px;animation-duration:${seconds}s"><span>🕷️</span></span>`).join('')}
    </div>`;
  }
  return '';
}

function currentSeason() {
  const h = halloween(clock());
  return h.spooky ? 'halloween' : h.christmas ? 'christmas' : null;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lines(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean);
}

const AVATAR_COLORS = ['#1A3157', '#2B6CB0', '#2F855A', '#B7791F', '#C05621', '#9B2C2C', '#6B46C1', '#2C7A7B'];

// A person's photo, their chosen food picture, or a colored circle with their first initial.
function presetAvatar(key, size) {
  const preset = AVATAR_PRESETS[key];
  return `<span class="avatar preset" aria-hidden="true" style="width:${size}px;height:${size}px;background:${preset.bg};font-size:${Math.round(size * 0.58)}px">${preset.emoji}</span>`;
}

function avatar(person, size = 36) {
  const style = `width:${size}px;height:${size}px`;
  if (person.preset && AVATAR_PRESETS[person.preset]) return presetAvatar(person.preset, size);
  if (person.avatarVersion) {
    return `<img class="avatar" src="/users/${person.id}/avatar?v=${person.avatarVersion}" alt="" style="${style}">`;
  }
  const color = AVATAR_COLORS[person.id % AVATAR_COLORS.length];
  const initial = [...String(person.name || '?').trim()][0] || '?';
  return `<span class="avatar initial" aria-hidden="true" style="${style};background:${color};font-size:${Math.round(size * 0.45)}px">${esc(initial.toUpperCase())}</span>`;
}

function personLink(person, size = 24) {
  return `<a href="/users/${person.id}" class="person">${avatar(person, size)}<span>${esc(person.name)}</span></a>`;
}

function layout({ title, user, body, bodyClass = '' }) {
  const season = currentSeason();
  const nav = user
    ? `<div class="signout">
         <a href="/users/${user.id}" class="me" aria-label="Your profile">${avatar(user, 36)}<span class="who">${esc(user.name)}</span></a>
         <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
       </div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Cool Cooking Recipes</title>
  <link rel="icon" href="/logo.svg">
  <link rel="stylesheet" href="/style.css">
  <script src="/app.js" defer></script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  <header class="top${season ? ` event ${season}` : ''}">
    ${headerDecor(season)}
    <a href="/" class="logo"><img src="/logo.svg" alt="Cool Cooking Recipes"></a>
    ${nav}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function errorBox(error) {
  return error ? `<p class="error">${esc(error)}</p>` : '';
}

function authPage({ mode, error, values = {} }) {
  const signup = mode === 'signup';
  return layout({
    title: signup ? 'Create account' : 'Sign in',
    body: `
      <section class="card narrow">
        <h1>${signup ? 'Create an account' : 'Sign in'}</h1>
        <p class="muted">You need to sign in to use Cool Cooking Recipes.</p>
        ${errorBox(error)}
        <form method="post" action="/${signup ? 'signup' : 'login'}" class="stack">
          ${signup ? `<label>Name<input name="name" required maxlength="60" value="${esc(values.name)}"></label>` : ''}
          <label>Email<input type="email" name="email" required value="${esc(values.email)}"></label>
          <label>Password<input type="password" name="password" required ${signup ? 'minlength="8"' : ''}></label>
          <button type="submit" class="btn">${signup ? 'Create account' : 'Sign in'}</button>
        </form>
        <p class="muted switch">
          ${signup
            ? 'Already have an account? <a href="/login">Sign in</a>'
            : 'New here? <a href="/signup">Create an account</a>'}
        </p>
      </section>`,
  });
}

// Floating food behind the main menu. Fixed values keep the layout stable between loads.
const FOODS = ['🍩', '🍔', '🍟', '🍪'];
const SPOOKY_FOODS = ['🎃', '👻', '🦇', '🍬', '🕷️', '🍭'];
const FLOATERS = [
  [4, 44, 22, -3], [14, 32, 18, -12], [24, 52, 26, -7], [34, 36, 20, -16],
  [46, 48, 24, -2], [56, 30, 17, -9], [66, 56, 28, -20], [76, 38, 21, -5],
  [86, 46, 25, -14], [94, 34, 19, -1], [9, 40, 23, -18], [40, 42, 27, -22],
  [61, 36, 20, -4], [89, 52, 26, -11],
];

// There's no candy cane emoji, so it's drawn: a white hook with red stripes.
const CANDY_CANE = '<svg class="candy-cane" viewBox="0 0 60 100" width="1em" height="1.6em"><path d="M22 95V36a15 15 0 0 1 30 0v6" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/><path d="M22 95V36a15 15 0 0 1 30 0v6" fill="none" stroke="#D62839" stroke-width="13" stroke-dasharray="7 9"/></svg>';
const CHRISTMAS_THINGS = [CANDY_CANE, '🎁', CANDY_CANE, '🎁', '🎁', CANDY_CANE];

// The Christmas main menu backdrop: night sky, falling snow, snowy hills and a little
// village of houses with glowing windows and twinkling lights. Drawn once at startup.
const BULB_COLORS = ['#FF4D4D', '#FFD93D', '#4DD07A', '#5AB0FF'];
function house(x, base, w, h, wall, roof) {
  const top = base - h;
  const peak = top - h * 0.7;
  const bulbs = [];
  for (let t = 0.08; t <= 0.92; t += 0.12) {
    const left = t <= 0.5;
    const u = left ? t / 0.5 : (t - 0.5) / 0.5;
    const bx = left ? x - 8 + (w / 2 + 8) * u : x + w / 2 + (w / 2 + 8) * u;
    const by = left ? top - (top - peak) * u : peak + (top - peak) * u;
    bulbs.push(`<circle class="bulb" cx="${bx.toFixed(1)}" cy="${(by + 5).toFixed(1)}" r="3" fill="${BULB_COLORS[bulbs.length % 4]}"/>`);
  }
  return `<g>
    <rect x="${x + w * 0.68}" y="${peak + h * 0.25}" width="${w * 0.14}" height="${h * 0.45}" fill="#5B3A2E"/>
    <rect x="${x + w * 0.66}" y="${peak + h * 0.2}" width="${w * 0.18}" height="6" rx="3" fill="#FFFFFF"/>
    <rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${wall}"/>
    <polygon points="${x - 10},${top + 2} ${x + w / 2},${peak} ${x + w + 10},${top + 2}" fill="${roof}"/>
    <polyline points="${x - 10},${top + 1} ${x + w / 2},${peak - 1} ${x + w + 10},${top + 1}" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
    <rect class="window" x="${x + w * 0.14}" y="${top + h * 0.22}" width="${w * 0.24}" height="${h * 0.26}" rx="2" fill="#FFD66B"/>
    <rect x="${x + w * 0.42}" y="${top + h * 0.5}" width="${w * 0.18}" height="${h * 0.5}" rx="2" fill="#6B3E26"/>
    <rect class="window" x="${x + w * 0.66}" y="${top + h * 0.22}" width="${w * 0.22}" height="${h * 0.26}" rx="2" fill="#FFD66B"/>
    ${bulbs.join('')}
  </g>`;
}
function tree(x, base, size) {
  const tiers = [0, 1, 2].map((i) => {
    const y = base - size * 0.3 - i * size * 0.28;
    const half = size * (0.42 - i * 0.1);
    return `<polygon points="${x - half},${y} ${x},${y - size * 0.42} ${x + half},${y}" fill="#1E6B3A"/>
      <polyline points="${x - half * 0.6},${y - size * 0.12} ${x},${y - size * 0.42} ${x + half * 0.6},${y - size * 0.12}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');
  return `<g><rect x="${x - size * 0.05}" y="${base - size * 0.3}" width="${size * 0.1}" height="${size * 0.3}" fill="#5B3A2E"/>${tiers}</g>`;
}
const WINTER_SCENE = `<div class="winter-scene" aria-hidden="true">
  <div class="snow far"></div><div class="snow near"></div>
  <svg class="village" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
    <path d="M0 215 Q180 165 380 205 T780 195 T1200 200 V300 H0Z" fill="#DCE7F5"/>
    ${tree(70, 214, 90)}${tree(1150, 205, 100)}${tree(560, 200, 70)}
    ${house(130, 232, 110, 70, '#B5332E', '#4A2C2A')}
    ${house(300, 238, 90, 60, '#2F6B4F', '#3B2A2A')}
    ${house(640, 236, 120, 76, '#2E5A9C', '#3A2B33')}
    ${house(830, 240, 95, 62, '#C9822B', '#4A2C2A')}
    ${house(990, 238, 105, 68, '#8E3B6E', '#3B2A2A')}
    ${tree(460, 250, 80)}${tree(940, 252, 64)}
    <path d="M0 245 Q220 215 460 240 T900 236 T1200 242 V300 H0Z" fill="#F6FAFF"/>
  </svg>
</div>`;

function foodBackground(foods = FOODS, { falling = false } = {}) {
  const items = FLOATERS.map(([left, size, seconds, delay], i) => `<span style="left:${left}%;font-size:${size}px;animation-duration:${seconds}s;animation-delay:${delay}s;--sway:${i % 2 ? -40 : 40}px">${foods[i % foods.length]}</span>`);
  return `<div class="food-bg${falling ? ' falling' : ''}" aria-hidden="true">${items.join('')}</div>`;
}

function homePage({ user, spooky = false, christmas = false, contestYear, winner = null }) {
  const banner = spooky
    ? `<a href="/contest" class="event-banner">
         <span class="event-emoji" aria-hidden="true">🏆</span>
         <span><strong>Spooky Food Contest ${contestYear}</strong><br>Enter your spookiest recipe and heart your favorites. Ends Halloween night!</span>
       </a>`
    : winner
      ? `<a href="/recipes/${winner.recipeId}" class="event-banner winner">
           <span class="event-emoji" aria-hidden="true">👑</span>
           <span><strong>Spookiest Food ${winner.year}:</strong> ${esc(winner.title)} by ${esc(winner.author)}</span>
         </a>`
      : '';
  return layout({
    title: 'Home',
    user,
    bodyClass: spooky ? 'home spooky' : christmas ? 'home christmas' : 'home',
    body: `
      ${christmas ? WINTER_SCENE + foodBackground(CHRISTMAS_THINGS, { falling: true }) : foodBackground(spooky ? SPOOKY_FOODS : FOODS)}
      <section class="welcome">
        ${spooky ? '<p class="spooky-hello">🎃 Happy Halloween! 🎃</p>' : ''}
        ${christmas ? '<p class="spooky-hello merry">🎄 Merry Christmas! 🎁</p>' : ''}
        <h1>Welcome to Cool Cooking Recipes</h1>
        <p class="sub">Press <strong>Create recipe</strong> to create your own recipe, and press <strong>Recipes</strong> to see other people's recipes. Your own recipes are in <strong>My recipes</strong>.</p>
        <div class="menu">
          <a href="/recipes" class="btn big">Recipes</a>
          <a href="/recipes/new" class="btn big secondary">Create recipe</a>
          <a href="/recipes/mine" class="btn big outline">My recipes</a>
        </div>
        ${banner}
      </section>`,
  });
}

function statusPill(recipe) {
  return recipe.verified
    ? '<span class="pill ok">Verified</span>'
    : '<span class="pill">Waiting to be verified</span>';
}

const HEART = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';

// Works without JavaScript as a normal form post; public/app.js upgrades it to toggle in place.
function heartButton(recipe, back) {
  const on = Boolean(recipe.favorited);
  return `<form method="post" action="/recipes/${recipe.id}/favorite" class="heart-form">
    <input type="hidden" name="back" value="${esc(back)}">
    <input type="hidden" name="favorite" value="${on ? '0' : '1'}">
    <button type="submit" class="heart${on ? ' on' : ''}" aria-pressed="${on}"
      aria-label="${on ? 'Remove' : 'Add'} ${esc(recipe.title)} ${on ? 'from' : 'to'} favorites">${HEART}</button>
  </form>`;
}

function recipeThumb(recipe) {
  const img = recipe.photoVersion
    ? `<img class="thumb" src="/recipes/${recipe.id}/photo?v=${recipe.photoVersion}" alt="" loading="lazy">`
    : '<span class="thumb empty" aria-hidden="true">🍽️</span>';
  return recipe.video
    ? `<span class="thumb-wrap">${img}<span class="play-badge" title="Has a video">▶<span class="sr-only"> Has a video</span></span></span>`
    : img;
}

// The player is built only from the parsed video ID (see lib/video.js).
function videoBlock(video) {
  if (!video) return '';
  const site = video.site === 'youtube' ? 'YouTube' : 'Instagram';
  return `<div class="video-wrap">
    <div class="video-frame ${video.site}${video.vertical ? ' vertical' : ''}">
      <iframe src="${esc(video.embed)}" title="Recipe video on ${site}" loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    <a href="${esc(video.link)}" target="_blank" rel="noopener noreferrer" class="video-link">Watch on ${site} ↗</a>
  </div>`;
}

// Each card links to the recipe; the author's name inside it links to their profile.
function recipeList(recipes, empty, { showStatus = false, showAuthor = !showStatus, hearts = null, editable = false } = {}) {
  if (!recipes.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="list">${recipes.map((r) => `
    <li class="recipe-card">
      ${recipeThumb(r)}
      <div class="card-body">
        ${showStatus ? statusPill(r) : ''}
        <a href="/recipes/${r.id}" class="title card-link">${esc(r.title)}</a>
        ${showAuthor ? `<span class="muted by">by ${personLink(r.authorPerson)}</span>` : `<span class="muted">Shared ${esc(r.created_on)}</span>`}
      </div>
      ${hearts ? heartButton(r, hearts) : ''}
      ${editable ? `<a href="/recipes/${r.id}/edit" class="btn small outline edit-link" aria-label="Edit ${esc(r.title)}">Edit</a>` : ''}
    </li>`).join('')}</ul>`;
}

function sectionLabel(section) {
  return `${section.emoji ? `<span aria-hidden="true">${esc(section.emoji)}</span> ` : ''}${esc(section.name)}`;
}

function recipesPage({ user, isAdmin, recipes, unverifiedCount, query, favoriteCount, notice = '', sections = [], section = null }) {
  const adminLink = isAdmin
    ? `<a href="/recipes/unverified" class="unverified-link">
         Unverified recipes <span class="badge">${unverifiedCount}</span>
       </a>`
    : '';
  // Links keep the search and the section together, so you can search inside a section.
  const href = ({ q = query, sec = section?.id } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (sec) params.set('section', sec);
    const qs = params.toString();
    return `/recipes${qs ? `?${qs}` : ''}`;
  };
  const chips = sections.length || isAdmin
    ? `<nav class="section-chips" aria-label="Recipe sections">
        <a href="${href({ sec: null })}" class="chip${section ? '' : ' active'}"${section ? '' : ' aria-current="page"'}>All</a>
        ${sections.map((x) => `<a href="${href({ sec: x.id })}" class="chip${section?.id === x.id ? ' active' : ''}"${section?.id === x.id ? ' aria-current="page"' : ''}>${sectionLabel(x)}</a>`).join('')}
        ${isAdmin ? '<a href="/sections" class="chip manage">⚙️ Manage sections</a>' : ''}
      </nav>`
    : '';
  const empty = query
    ? 'No recipes match your search.'
    : section
      ? `No recipes in ${section.name} yet.`
      : 'No recipes yet. Be the first to create one!';
  const results = query || section
    ? `<p class="muted">${recipes.length} recipe${recipes.length === 1 ? '' : 's'}${section ? ` in ${sectionLabel(section)}` : ''}${query ? ` for “${esc(query)}”` : ''} · <a href="/recipes">Clear</a></p>`
    : '';
  return layout({
    title: section ? `${section.name} recipes` : 'Recipes',
    user,
    body: `
      <div class="page-head">
        <h1>Recipes</h1>
        <div class="head-actions">
          <a href="/recipes/favorites" class="btn outline favorites-link">${HEART} Favorites <span class="count">${favoriteCount}</span></a>
          <a href="/recipes/new" class="btn">Create recipe</a>
        </div>
      </div>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${adminLink}
      ${chips}
      <form method="get" action="/recipes" class="search" role="search">
        ${section ? `<input type="hidden" name="section" value="${section.id}">` : ''}
        <input type="search" name="q" value="${esc(query)}" placeholder="${section ? `Search in ${esc(section.name)}` : 'Search recipes or ingredients'}" aria-label="Search recipes">
        <button type="submit" class="btn">Search</button>
      </form>
      ${results}
      ${recipeList(recipes, empty, { hearts: href() })}`,
  });
}

function sectionsPage({ user, sections, notice = '', error = '', values = {} }) {
  return layout({
    title: 'Manage sections',
    user,
    body: `
      <p><a href="/recipes">← Back to recipes</a></p>
      <h1>Manage sections</h1>
      <p class="muted">Only you can see this page. Sections show as buttons at the top of Recipes. To put a recipe in a section, open the recipe and tick its sections.</p>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${errorBox(error)}
      <section class="card">
        <h2>Add a section</h2>
        <form method="post" action="/sections" class="section-row">
          <input name="emoji" value="${esc(values.emoji)}" placeholder="🍝" maxlength="8" aria-label="Emoji (optional)" class="emoji-input">
          <input name="name" value="${esc(values.name)}" placeholder="Section name, like Pasta" maxlength="40" required aria-label="Section name">
          <button type="submit" class="btn">Add</button>
        </form>
      </section>
      <h2>Your sections</h2>
      ${sections.length ? `<ul class="list section-list">${sections.map((x) => `
        <li>
          <form method="post" action="/sections/${x.id}" class="section-row">
            <input name="emoji" value="${esc(x.emoji)}" maxlength="8" aria-label="Emoji for ${esc(x.name)}" class="emoji-input">
            <input name="name" value="${esc(x.name)}" maxlength="40" required aria-label="Name for ${esc(x.name)}">
            <button type="submit" class="btn small outline">Save</button>
          </form>
          <div class="section-meta">
            <a href="/recipes?section=${x.id}">${x.count} recipe${x.count === 1 ? '' : 's'}</a>
            <form method="post" action="/sections/${x.id}/delete" onsubmit="return confirm(this.dataset.confirm)"
              data-confirm="${esc(`Delete the ${x.name} section? Its recipes stay in Recipes.`)}">
              <button type="submit" class="link small-link">Delete section</button>
            </form>
          </div>
        </li>`).join('')}</ul>` : '<p class="muted">No sections yet. Add your first one above.</p>'}`,
  });
}

function favoritesPage({ user, recipes }) {
  return layout({
    title: 'Favorites',
    user,
    body: `
      <p><a href="/recipes">← Back to recipes</a></p>
      <h1>Favorites</h1>
      <p class="muted">Press the heart on any recipe to save it here.</p>
      ${recipeList(recipes, "You haven't favorited any recipes yet.", { hearts: '/recipes/favorites' })}`,
  });
}

function myRecipesPage({ user, recipes, notice }) {
  return layout({
    title: 'My recipes',
    user,
    body: `
      <div class="page-head">
        <h1>My recipes</h1>
        <a href="/recipes/new" class="btn">Create recipe</a>
      </div>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${recipeList(recipes, "You haven't shared any recipes yet.", { showStatus: true, editable: true })}`,
  });
}

function unverifiedPage({ user, recipes }) {
  const items = recipes.length
    ? `<ul class="list">${recipes.map((r) => `
        <li class="recipe-card">
          ${recipeThumb(r)}
          <div class="card-body">
            <a href="/recipes/${r.id}" class="title card-link">${esc(r.title)}</a>
            <span class="muted by">by ${personLink(r.authorPerson)}</span>
          </div>
          <div class="actions">
            <form method="post" action="/recipes/${r.id}/verify"><button class="btn small">Verify</button></form>
            <form method="post" action="/recipes/${r.id}/delete" onsubmit="return confirm('Delete this recipe?')"><button class="btn small danger">Delete</button></form>
          </div>
        </li>`).join('')}</ul>`
    : '<p class="muted">No recipes are waiting to be verified.</p>';
  return layout({
    title: 'Unverified recipes',
    user,
    body: `
      <p><a href="/recipes">← Back to recipes</a></p>
      <h1>Unverified recipes</h1>
      <p class="muted">Only you can see this. Verified recipes show up for everyone in Recipes.</p>
      ${items}`,
  });
}

function timeAgo(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function commentForm({ recipe, user, parent = null, mention = '', placeholder }) {
  return `<form method="post" action="/recipes/${recipe.id}/comments" class="comment-form${parent ? ' reply-form' : ''}">
    ${avatar(user, parent ? 28 : 40)}
    <div class="comment-input">
      ${parent ? `<input type="hidden" name="parent_id" value="${parent.id}">` : ''}
      <textarea name="body" rows="1" maxlength="1000" required placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${esc(mention)}</textarea>
      <div class="comment-buttons"><button type="submit" class="btn small">${parent ? 'Reply' : 'Comment'}</button></div>
    </div>
  </form>`;
}

function commentItem({ comment, recipe, user, canModerate, thread }) {
  const canDelete = comment.user_id === user.id || canModerate;
  const replyTo = thread || comment; // replies always join the top-level thread, like YouTube
  const mention = thread ? `@${comment.author.name} ` : '';
  return `<div class="comment" id="comment-${comment.id}">
    <a href="/users/${comment.author.id}" class="comment-avatar" aria-label="${esc(comment.author.name)}">${avatar(comment.author, thread ? 28 : 40)}</a>
    <div class="comment-main">
      <p class="comment-meta">
        <a href="/users/${comment.author.id}" class="comment-name">${esc(comment.author.name)}</a>
        ${comment.author.id === recipe.author_id ? '<span class="creator">Chef</span>' : ''}
        <span class="muted">${timeAgo(comment.age_seconds)}</span>
      </p>
      <p class="comment-body">${esc(comment.body)}</p>
      <div class="comment-actions">
        <details class="reply-toggle">
          <summary>Reply</summary>
          ${commentForm({ recipe, user, parent: replyTo, mention, placeholder: 'Add a reply…' })}
        </details>
        ${canDelete ? `<form method="post" action="/comments/${comment.id}/delete" onsubmit="return confirm('Delete this comment?')">
          <button type="submit" class="link small-link">Delete</button></form>` : ''}
      </div>
    </div>
  </div>`;
}

function commentSection({ recipe, user, comments, canModerate }) {
  if (!recipe.verified) {
    return '<section class="comments"><p class="muted">Comments open once this recipe has been verified.</p></section>';
  }
  const isCreator = recipe.author_id === user.id;
  const toggle = isCreator ? `<form method="post" action="/recipes/${recipe.id}/comments/toggle" class="comments-toggle">
      <input type="hidden" name="off" value="${recipe.commentsOff ? '0' : '1'}">
      <button type="submit" class="btn small outline">${recipe.commentsOff ? 'Turn on comments' : 'Turn off comments'}</button>
    </form>` : '';
  if (recipe.commentsOff) {
    return `<section class="comments" id="comments">
      <div class="comments-head"><h2>Comments</h2>${toggle}</div>
      <p class="comments-off">Comments are turned off.${isCreator ? ' Your old comments are saved and will come back if you turn comments on.' : ''}</p>
    </section>`;
  }
  const top = comments.filter((c) => !c.parent_id);
  const repliesOf = (c) => comments.filter((r) => r.parent_id === c.id);
  const total = comments.length;
  return `<section class="comments" id="comments">
    <div class="comments-head"><h2>${total} Comment${total === 1 ? '' : 's'}</h2>${toggle}</div>
    ${commentForm({ recipe, user, placeholder: 'Add a comment…' })}
    <div class="comment-list">
      ${top.length ? top.map((c) => {
        const replies = repliesOf(c);
        return `<div class="thread">
          ${commentItem({ comment: c, recipe, user, canModerate })}
          ${replies.length ? `<details class="replies"${replies.some((r) => r.open) ? ' open' : ''}>
            <summary><span class="chev" aria-hidden="true">▾</span> ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</summary>
            ${replies.map((r) => commentItem({ comment: r, recipe, user, canModerate, thread: c })).join('')}
          </details>` : ''}
        </div>`;
      }).join('') : '<p class="muted">No comments yet. Be the first to say something nice!</p>'}
    </div>
  </section>`;
}

function crownBadges(crowns) {
  return crowns.map((c) => `<span class="crown">👑 Spookiest Food ${c.year}</span>`).join('');
}

function contestBox(recipe, contest, isAuthor) {
  if (!contest.open) return '';
  if (isAuthor) {
    return `<form method="post" action="/recipes/${recipe.id}/contest" class="contest-box">
      <span>${contest.entered ? '🎃 Entered in the <a href="/contest">Spooky Food Contest</a>!' : '🎃 Is this a spooky food? Enter it in the <a href="/contest">Spooky Food Contest</a>.'}</span>
      <input type="hidden" name="enter" value="${contest.entered ? '0' : '1'}">
      <button type="submit" class="btn small${contest.entered ? ' outline' : ' spooky-btn'}">${contest.entered ? 'Leave contest' : 'Enter the Spooky Food Contest'}</button>
    </form>`;
  }
  return contest.entered
    ? '<p class="contest-box">🎃 This recipe is in the <a href="/contest">Spooky Food Contest</a>. Press the heart to vote for it!</p>'
    : '';
}

function recipePage({ user, isAdmin, recipe, notice, comments = [], canModerate = false, contest = { open: false, crowns: [] }, sections = [] }) {
  const pending = !recipe.verified;
  const isAuthor = recipe.author_id === user.id;
  // Authors edit their own recipes; only the admin can edit and delete everyone's.
  const canEdit = isAuthor || isAdmin;
  const deleteForm = `<form method="post" action="/recipes/${recipe.id}/delete" onsubmit="return confirm('Delete this recipe for everyone? This can\'t be undone.')"><button class="btn danger">Delete recipe</button></form>`;
  const adminEdit = isAuthor ? '' : `<a href="/recipes/${recipe.id}/edit" class="btn outline">Edit recipe</a>`;
  const adminActions = isAdmin
    ? (pending
      ? `<div class="actions">
           <form method="post" action="/recipes/${recipe.id}/verify"><button class="btn">Verify</button></form>
           ${adminEdit}
           ${deleteForm}
         </div>`
      : `<div class="actions admin-actions"><span class="muted">Admin:</span>
           ${adminEdit}
           ${deleteForm}
         </div>`)
    : '';
  return layout({
    title: recipe.title,
    user,
    body: `
      <p><a href="${pending && isAdmin ? '/recipes/unverified' : '/recipes'}">← Back</a></p>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      <article class="card">
        ${recipe.photoVersion ? `<img class="recipe-photo" src="/recipes/${recipe.id}/photo?v=${recipe.photoVersion}" alt="Photo of ${esc(recipe.title)}">` : ''}
        ${pending ? '<p class="pill">Waiting to be verified</p>' : ''}
        <div class="recipe-title-row">
          <h1>${esc(recipe.title)}</h1>
          ${isAuthor ? `<a href="/recipes/${recipe.id}/edit" class="btn outline">Edit recipe</a>` : ''}
        </div>
        ${crownBadges(contest.crowns)}
        ${sections.some((x) => x.checked) ? `<p class="recipe-sections">${sections.filter((x) => x.checked).map((x) => `<a href="/recipes?section=${x.id}" class="chip small">${sectionLabel(x)}</a>`).join('')}</p>` : ''}
        <p class="muted by">by ${personLink(recipe.authorPerson, 28)}</p>
        ${contestBox(recipe, contest, isAuthor)}
        ${videoBlock(recipe.video)}
        <h2>Ingredients</h2>
        <ul>${lines(recipe.ingredients).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <h2>Steps</h2>
        <ol>${lines(recipe.steps).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        ${adminActions}
        ${isAdmin ? `<form method="post" action="/recipes/${recipe.id}/sections" class="section-picker" id="sections">
          <fieldset>
            <legend>Sections <span class="hint">(only you can change these)</span></legend>
            ${sections.length ? sections.map((x) => `<label class="section-check"><input type="checkbox" name="section_ids" value="${x.id}"${x.checked ? ' checked' : ''}> ${sectionLabel(x)}</label>`).join('') : '<p class="muted">No sections yet. <a href="/sections">Add some</a>.</p>'}
          </fieldset>
          ${sections.length ? '<button type="submit" class="btn small">Save sections</button>' : ''}
          <a href="/sections" class="small-link">Manage sections</a>
        </form>` : ''}
      </article>
      ${commentSection({ recipe, user, comments, canModerate })}`,
  });
}

// One form for creating and editing. `recipe` is set when editing an existing one.
function recipeFormPage({ user, error, values = {}, recipe = null, sendsBackToReview = false, editingFor = null }) {
  const editing = Boolean(recipe);
  const removing = values.remove_photo === '1';
  // Show the photo just picked, otherwise the recipe's current photo (unless it's being removed).
  const currentPhoto = values.photo
    || (editing && recipe.photoVersion && !removing ? `/recipes/${recipe.id}/photo?v=${recipe.photoVersion}` : '');
  return layout({
    title: editing ? `Edit ${recipe.title}` : 'Create recipe',
    user,
    body: `
      ${editing ? `<p><a href="/recipes/${recipe.id}">← Back to recipe</a></p>` : ''}
      <section class="card">
        <h1>${editing ? 'Edit recipe' : 'Create recipe'}</h1>
        ${errorBox(error)}
        ${editingFor ? `<p class="notice">You're editing ${esc(editingFor)}'s recipe as the admin. It stays ${recipe.verified ? 'published' : 'waiting for review'}, and still shows ${esc(editingFor)} as the author.</p>` : ''}
        ${sendsBackToReview ? '<p class="warning">Saving changes sends this recipe back to be verified. It will be hidden from Recipes until then.</p>' : ''}
        <form method="post" action="${editing ? `/recipes/${recipe.id}/edit` : '/recipes'}" class="stack">
          <label>Recipe name<input name="title" required maxlength="100" value="${esc(values.title)}"></label>
          <label>Ingredients <span class="hint">(one per line)</span>
            <textarea name="ingredients" rows="6" required>${esc(values.ingredients)}</textarea></label>
          <label>Steps <span class="hint">(one per line)</span>
            <textarea name="steps" rows="8" required>${esc(values.steps)}</textarea></label>
          <div class="photo-field">
            <span class="field-label">Photo <span class="hint">(optional)</span></span>
            <div id="photo-preview" class="photo-preview"${currentPhoto ? '' : ' hidden'}>
              ${currentPhoto ? `<img src="${esc(currentPhoto)}" alt="Your recipe photo">` : ''}
            </div>
            <div class="photo-actions">
              <label class="btn outline file-btn">Upload photo
                <input type="file" id="photo-file" accept="image/*" hidden>
              </label>
              <button type="button" class="link" id="photo-remove"${currentPhoto ? '' : ' hidden'}>Remove photo</button>
            </div>
            <p class="muted hint" id="photo-hint">Show everyone what your dish looks like.</p>
            <input type="hidden" name="photo" id="photo-data" value="${esc(values.photo)}">
            <input type="hidden" name="remove_photo" id="photo-remove-flag" value="${removing ? '1' : '0'}">
            <noscript><p class="error">Turn on JavaScript to upload a photo.</p></noscript>
          </div>
          <label>Video link <span class="hint">(optional)</span>
            <input type="url" name="video_url" inputmode="url" value="${esc(values.video_url)}"
              placeholder="Paste an Instagram or YouTube link">
            <span class="hint">The video will play right on the recipe page.</span>
          </label>
          <button type="submit" class="btn">${editing ? 'Save changes' : 'Submit recipe'}</button>
        </form>
        ${editing ? '' : `<p class="muted">New recipes appear in Recipes once they've been verified.</p>`}
      </section>`,
  });
}

function newRecipePage({ user, error, values }) {
  return recipeFormPage({ user, error, values });
}

function profilePage({ user, person, recipes, isMe, crowns = [] }) {
  const count = `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`;
  return layout({
    title: person.name,
    user,
    body: `
      <section class="card profile-head">
        ${avatar(person, 96)}
        <div class="profile-info">
          <h1>${esc(person.name)}</h1>
          <p class="muted">${count} · Joined ${esc(person.joined_on)}</p>
          ${crowns.map((c) => `<a href="/recipes/${c.recipeId}" class="crown">👑 Spookiest Food ${c.year}: ${esc(c.title)}</a>`).join('')}
        </div>
        ${isMe ? '<a href="/profile" class="btn">Change profile</a>' : ''}
      </section>
      <h2>${isMe ? 'Your recipes' : `Recipes by ${esc(person.name)}`}</h2>
      ${isMe ? '<p class="muted">Only verified recipes show here. See all of yours, including ones waiting to be verified, in <a href="/recipes/mine">My recipes</a>.</p>' : ''}
      ${recipeList(recipes, isMe ? "You don't have any verified recipes yet." : `${person.name} hasn't shared any verified recipes yet.`, { showAuthor: false, hearts: `/users/${person.id}` })}`,
  });
}

function editProfilePage({ user, error, notice }) {
  return layout({
    title: 'Change profile',
    user,
    body: `
      <p><a href="/users/${user.id}">← Back to your profile</a></p>
      <section class="card narrow">
        <h1>Change profile</h1>
        ${errorBox(error)}
        ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
        <form method="post" action="/profile" class="stack" id="profile-form">
          <div class="avatar-edit">
            <span id="avatar-preview">${avatar(user, 96)}</span>
            <p class="muted hint" id="avatar-hint">Pick a food picture or upload your own photo, then press Save.</p>
          </div>
          <fieldset class="preset-grid">
            <legend>Pick a food picture</legend>
            ${Object.entries(AVATAR_PRESETS).map(([key, p]) => `
              <label class="preset-option" title="${p.label}">
                <input type="radio" name="preset" value="${key}"${user.preset === key ? ' checked' : ''}>
                ${presetAvatar(key, 56)}
                <span class="preset-label">${p.label}</span>
              </label>`).join('')}
          </fieldset>
          <div class="upload-row">
            <span class="muted">Or use your own photo:</span>
            <label class="btn outline file-btn">Upload a photo
              <input type="file" id="avatar-file" accept="image/*" hidden>
            </label>
          </div>
          <input type="hidden" name="avatar" id="avatar-data">
          <noscript><p class="error">Turn on JavaScript to upload a picture.</p></noscript>
          <label>Name<input name="name" required maxlength="60" value="${esc(user.name)}"></label>
          <button type="submit" class="btn">Save</button>
        </form>
        ${user.avatarVersion || user.preset ? `<form method="post" action="/profile/avatar/remove" class="remove-avatar">
          <button type="submit" class="link">Remove my picture</button>
        </form>` : ''}
      </section>`,
  });
}

function contestPage({ user, year, open, entries, winner }) {
  const intro = open
    ? `Enter your spookiest recipe from its page, and press the heart on the ones you love. Hearts given in October are the votes (hearting your own recipe doesn't count). The contest ends at midnight on Halloween, and the winner gets a 👑 crown.`
    : entries.length
      ? `The ${year} contest is over. Thanks to everyone who entered and voted!`
      : 'The Spooky Food Contest runs every October. Come back then to enter your spookiest recipe!';
  return layout({
    title: `Spooky Food Contest ${year}`,
    user,
    body: `
      <section class="card contest-head">
        <p class="contest-trophy" aria-hidden="true">🏆</p>
        <h1>Spooky Food Contest ${year}</h1>
        <p class="muted">${intro}</p>
        ${winner ? `<a href="/recipes/${winner.recipeId}" class="crown big-crown">👑 Winner: ${esc(winner.title)} by ${esc(winner.author)} (${winner.hearts} heart${winner.hearts === 1 ? '' : 's'})</a>` : ''}
      </section>
      ${entries.length ? `<h2>${open ? 'Current standings' : 'Final standings'}</h2>
      <ol class="list standings">${entries.map((r, i) => `
        <li class="recipe-card">
          <span class="place" aria-label="Place ${i + 1}">${i === 0 && r.votes > 0 ? '🥇' : i === 1 && r.votes > 0 ? '🥈' : i === 2 && r.votes > 0 ? '🥉' : i + 1}</span>
          ${recipeThumb(r)}
          <div class="card-body">
            <a href="/recipes/${r.id}" class="title card-link">${esc(r.title)}</a>
            <span class="muted by">by ${personLink(r.authorPerson)} · ${r.votes} vote${r.votes === 1 ? '' : 's'}</span>
          </div>
          ${open ? heartButton(r, '/contest') : ''}
        </li>`).join('')}</ol>` : (open ? '<p class="muted">No entries yet. Be the first!</p>' : '')}`,
  });
}

function notFoundPage({ user }) {
  return layout({
    title: 'Not found',
    user,
    body: '<h1>Page not found</h1><p><a href="/">Go home</a></p>',
  });
}

module.exports = {
  setClock,
  authPage, homePage, recipesPage, favoritesPage, myRecipesPage, unverifiedPage, recipePage, newRecipePage, recipeFormPage,
  profilePage, editProfilePage, contestPage, sectionsPage, notFoundPage,
};
