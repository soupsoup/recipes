const { AVATAR_PRESETS } = require('./presets');

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
  <header class="top">
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
const FLOATERS = [
  [4, 44, 22, -3], [14, 32, 18, -12], [24, 52, 26, -7], [34, 36, 20, -16],
  [46, 48, 24, -2], [56, 30, 17, -9], [66, 56, 28, -20], [76, 38, 21, -5],
  [86, 46, 25, -14], [94, 34, 19, -1], [9, 40, 23, -18], [40, 42, 27, -22],
  [61, 36, 20, -4], [89, 52, 26, -11],
];

function foodBackground() {
  const items = FLOATERS.map(([left, size, seconds, delay], i) => `<span style="left:${left}%;font-size:${size}px;animation-duration:${seconds}s;animation-delay:${delay}s;--sway:${i % 2 ? -40 : 40}px">${FOODS[i % FOODS.length]}</span>`);
  return `<div class="food-bg" aria-hidden="true">${items.join('')}</div>`;
}

function homePage({ user }) {
  return layout({
    title: 'Home',
    user,
    bodyClass: 'home',
    body: `
      ${foodBackground()}
      <section class="welcome">
        <h1>Welcome to Cool Cooking Recipes</h1>
        <p class="sub">Press <strong>Create recipe</strong> to create your own recipe, and press <strong>Recipes</strong> to see other people's recipes. Your own recipes are in <strong>My recipes</strong>.</p>
        <div class="menu">
          <a href="/recipes" class="btn big">Recipes</a>
          <a href="/recipes/new" class="btn big secondary">Create recipe</a>
          <a href="/recipes/mine" class="btn big outline">My recipes</a>
        </div>
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
  return recipe.photoVersion
    ? `<img class="thumb" src="/recipes/${recipe.id}/photo?v=${recipe.photoVersion}" alt="" loading="lazy">`
    : '<span class="thumb empty" aria-hidden="true">🍽️</span>';
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

function recipesPage({ user, isAdmin, recipes, unverifiedCount, query, favoriteCount }) {
  const adminLink = isAdmin
    ? `<a href="/recipes/unverified" class="unverified-link">
         Unverified recipes <span class="badge">${unverifiedCount}</span>
       </a>`
    : '';
  return layout({
    title: 'Recipes',
    user,
    body: `
      <div class="page-head">
        <h1>Recipes</h1>
        <div class="head-actions">
          <a href="/recipes/favorites" class="btn outline favorites-link">${HEART} Favorites <span class="count">${favoriteCount}</span></a>
          <a href="/recipes/new" class="btn">Create recipe</a>
        </div>
      </div>
      ${adminLink}
      <form method="get" action="/recipes" class="search" role="search">
        <input type="search" name="q" value="${esc(query)}" placeholder="Search recipes or ingredients" aria-label="Search recipes">
        <button type="submit" class="btn">Search</button>
      </form>
      ${query ? `<p class="muted">${recipes.length} result${recipes.length === 1 ? '' : 's'} for “${esc(query)}” · <a href="/recipes">Clear</a></p>` : ''}
      ${recipeList(recipes, query ? 'No recipes match your search.' : 'No recipes yet. Be the first to create one!', { hearts: query ? `/recipes?q=${encodeURIComponent(query)}` : '/recipes' })}`,
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

function recipePage({ user, isAdmin, recipe, notice }) {
  const pending = !recipe.verified;
  const isAuthor = recipe.author_id === user.id;
  const adminActions = isAdmin && pending
    ? `<div class="actions">
         <form method="post" action="/recipes/${recipe.id}/verify"><button class="btn">Verify</button></form>
         <form method="post" action="/recipes/${recipe.id}/delete" onsubmit="return confirm('Delete this recipe?')"><button class="btn danger">Delete</button></form>
       </div>`
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
        <p class="muted by">by ${personLink(recipe.authorPerson, 28)}</p>
        <h2>Ingredients</h2>
        <ul>${lines(recipe.ingredients).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <h2>Steps</h2>
        <ol>${lines(recipe.steps).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        ${adminActions}
      </article>`,
  });
}

// One form for creating and editing. `recipe` is set when editing an existing one.
function recipeFormPage({ user, error, values = {}, recipe = null, sendsBackToReview = false }) {
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
          <button type="submit" class="btn">${editing ? 'Save changes' : 'Submit recipe'}</button>
        </form>
        ${editing ? '' : `<p class="muted">New recipes appear in Recipes once they've been verified.</p>`}
      </section>`,
  });
}

function newRecipePage({ user, error, values }) {
  return recipeFormPage({ user, error, values });
}

function profilePage({ user, person, recipes, isMe }) {
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

function notFoundPage({ user }) {
  return layout({
    title: 'Not found',
    user,
    body: '<h1>Page not found</h1><p><a href="/">Go home</a></p>',
  });
}

module.exports = {
  authPage, homePage, recipesPage, favoritesPage, myRecipesPage, unverifiedPage, recipePage, newRecipePage, recipeFormPage,
  profilePage, editProfilePage, notFoundPage,
};
