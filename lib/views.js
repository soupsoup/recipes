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

function layout({ title, user, body, bodyClass = '' }) {
  const nav = user
    ? `<form method="post" action="/logout" class="signout">
         <span class="who">${esc(user.name)}</span>
         <button type="submit" class="link">Sign out</button>
       </form>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Cool Cooking Recipes</title>
  <link rel="icon" href="/logo.svg">
  <link rel="stylesheet" href="/style.css">
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

function homePage({ user }) {
  return layout({
    title: 'Home',
    user,
    bodyClass: 'home',
    body: `
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

function recipeList(recipes, empty, { showStatus = false } = {}) {
  if (!recipes.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="list">${recipes.map((r) => `
    <li><a href="/recipes/${r.id}">
      ${showStatus ? statusPill(r) : ''}
      <span class="title">${esc(r.title)}</span>
      <span class="muted">${showStatus ? `Shared ${esc(r.created_at.slice(0, 10))}` : `by ${esc(r.author)}`}</span>
    </a></li>`).join('')}</ul>`;
}

function recipesPage({ user, isAdmin, recipes, unverifiedCount, query }) {
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
        <a href="/recipes/new" class="btn">Create recipe</a>
      </div>
      ${adminLink}
      <form method="get" action="/recipes" class="search" role="search">
        <input type="search" name="q" value="${esc(query)}" placeholder="Search recipes or ingredients" aria-label="Search recipes">
        <button type="submit" class="btn">Search</button>
      </form>
      ${query ? `<p class="muted">${recipes.length} result${recipes.length === 1 ? '' : 's'} for “${esc(query)}” · <a href="/recipes">Clear</a></p>` : ''}
      ${recipeList(recipes, query ? 'No recipes match your search.' : 'No recipes yet. Be the first to create one!')}`,
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
      ${recipeList(recipes, "You haven't shared any recipes yet.", { showStatus: true })}`,
  });
}

function unverifiedPage({ user, recipes }) {
  const items = recipes.length
    ? `<ul class="list">${recipes.map((r) => `
        <li class="row">
          <a href="/recipes/${r.id}">
            <span class="title">${esc(r.title)}</span>
            <span class="muted">by ${esc(r.author)}</span>
          </a>
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

function recipePage({ user, isAdmin, recipe }) {
  const pending = !recipe.verified;
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
      <article class="card">
        ${pending ? '<p class="pill">Waiting to be verified</p>' : ''}
        <h1>${esc(recipe.title)}</h1>
        <p class="muted">by ${esc(recipe.author)}</p>
        <h2>Ingredients</h2>
        <ul>${lines(recipe.ingredients).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <h2>Steps</h2>
        <ol>${lines(recipe.steps).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        ${adminActions}
      </article>`,
  });
}

function newRecipePage({ user, error, values = {} }) {
  return layout({
    title: 'Create recipe',
    user,
    body: `
      <section class="card">
        <h1>Create recipe</h1>
        ${errorBox(error)}
        <form method="post" action="/recipes" class="stack">
          <label>Recipe name<input name="title" required maxlength="100" value="${esc(values.title)}"></label>
          <label>Ingredients <span class="hint">(one per line)</span>
            <textarea name="ingredients" rows="6" required>${esc(values.ingredients)}</textarea></label>
          <label>Steps <span class="hint">(one per line)</span>
            <textarea name="steps" rows="8" required>${esc(values.steps)}</textarea></label>
          <button type="submit" class="btn">Submit recipe</button>
        </form>
        <p class="muted">New recipes appear in Recipes once they've been verified.</p>
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
  authPage, homePage, recipesPage, myRecipesPage, unverifiedPage, recipePage, newRecipePage, notFoundPage,
};
