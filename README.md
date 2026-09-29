# Cool Cooking Recipes

A small recipe-sharing web app. People sign in, share recipes and browse other
people's recipes. New recipes stay hidden until the admin verifies them.

## Run it locally

Requires Node.js 20 or newer.

```sh
npm install
ADMIN_EMAIL=you@example.com npm start
```

Then open http://localhost:3000. Without `DATABASE_URL`, the app stores its
data in `data/pglite` using PGlite (Postgres running inside Node), so no
database server is needed.

- `ADMIN_EMAIL`: the account that sees **Unverified recipes** and can verify or
  delete them. Sign up with this email to become the admin.
- `DATABASE_URL`: a Postgres connection string. Set this in production.
- `PORT`: port to listen on (default `3000`).

## Deploy to Vercel

The database lives in the Supabase project `cool-cooking-recipes`. Its tables
come from `supabase/migrations/`.

1. In Supabase, open the project, press **Connect**, and copy the
   **Transaction pooler** connection string (port 6543). If you don't know the
   database password, reset it under **Project Settings → Database** and put
   the new one into the string.
2. On vercel.com, choose **Add New → Project** and import this GitHub repo.
3. Before deploying, add two environment variables:
   - `DATABASE_URL`: the connection string from step 1
   - `ADMIN_EMAIL`: your email
4. Press **Deploy**. Every push to the connected branch redeploys the app.

`api/index.js` runs the Express app as a Vercel function, and `vercel.json`
sends every request that isn't a file in `public/` to it.

## How it works

- Every page except sign in and sign up requires an account.
- The home screen has three options: **Recipes**, **Create recipe** and
  **My recipes**.
- Recipes has a search bar that matches recipe names and ingredients.
- Create recipe has an optional **Upload photo** button. The browser shrinks
  the photo to at most 1000px before upload, and the photo follows the same
  rules as its recipe: only the author and the admin see it until it's verified.
- Only the person who made a recipe can edit it (**Edit recipe** on the recipe,
  or **Edit** in My recipes). Editing a verified recipe sends it back to be
  verified, unless the admin edited their own recipe.
- Verified recipes have a YouTube-style comment section: newest comments first,
  **Reply** under each comment, and replies tucked under "N replies". The recipe's
  author is labelled **Chef**. People can delete their own comments; the recipe's
  author and the admin can delete any comment on it. The author can also
  **Turn off comments**, which hides them (without deleting) until turned back on.
- **Halloween (every October, US Eastern time):** the main menu turns spooky
  (🎃 👻 🦇 🍬 🕷️ float by) and shows the **Spooky Food Contest**. Creators enter a
  verified recipe from its page; hearts from other people are the votes. After
  Halloween the winner is saved, gets a 👑 badge on the recipe and profile, and is
  announced on the main menu until November 14. Preview it locally with
  `SPOOKY_PREVIEW_DATE=2026-10-15 npm start`. Dates live in `lib/halloween.js`.
- My recipes lists everything you've shared, marked verified or waiting.
- Each verified recipe has a heart. Pressing it saves the recipe to your
  **Favorites** (a button at the top of Recipes); pressing it again removes it.
  Favorites are private to each account.
- Pressing a person's name opens their profile: their picture, name and
  verified recipes. Emails are never shown.
- On your own profile, **Change profile** lets you pick one of 13 food
  pictures or upload a photo (cropped to a small square in the browser before
  upload), and change your name. The food choices live in `lib/presets.js`.
- A new recipe starts as unverified. Only its author and the admin can open it.
- The admin sees an **Unverified recipes** section at the top of Recipes.
  Pressing **Verify** moves a recipe into the public list.

## Tests

```sh
npm test
```
