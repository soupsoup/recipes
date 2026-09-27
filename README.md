# Cool Cooking Recipes

A small recipe-sharing web app. People sign in, share recipes and browse other
people's recipes. New recipes stay hidden until the admin verifies them.

## Run it

Requires Node.js 22.5 or newer (the app uses Node's built-in SQLite).

```sh
npm install
ADMIN_EMAIL=you@example.com npm start
```

Then open http://localhost:3000.

- `ADMIN_EMAIL`: the account that sees **Unverified recipes** and can verify or
  delete them. Sign up with this email to become the admin.
- `PORT`: port to listen on (default `3000`).
- `DB_FILE`: where the SQLite database lives (default `data/recipes.db`).

## How it works

- Every page except sign in and sign up requires an account.
- The home screen has three options: **Recipes**, **Create recipe** and
  **My recipes**.
- Recipes has a search bar that matches recipe names and ingredients.
- My recipes lists everything you've shared, marked verified or waiting.
- A new recipe starts as unverified. Only its author and the admin can open it.
- The admin sees an **Unverified recipes** section at the top of Recipes.
  Pressing **Verify** moves a recipe into the public list.

## Tests

```sh
npm test
```
