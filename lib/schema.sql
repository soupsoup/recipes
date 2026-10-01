CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS recipes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  steps TEXT NOT NULL,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipes_author_id_idx ON recipes (author_id);
CREATE INDEX IF NOT EXISTS recipes_verified_idx ON recipes (verified);

CREATE TABLE IF NOT EXISTS favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS favorites_recipe_id_idx ON favorites (recipe_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_preset TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo BYTEA;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_type TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Replies point at the top-level comment they belong to, one level deep like YouTube.
  parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_recipe_id_idx ON comments (recipe_id);
CREATE INDEX IF NOT EXISTS comments_parent_id_idx ON comments (parent_id);
CREATE INDEX IF NOT EXISTS comments_user_id_idx ON comments (user_id);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS comments_off BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contest_entries (
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  year INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, year)
);
-- The winner is written once, right after the contest ends, so later hearts can't change it.
CREATE TABLE IF NOT EXISTS contest_winners (
  year INT PRIMARY KEY,
  recipe_id BIGINT REFERENCES recipes(id) ON DELETE SET NULL,
  hearts INT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS video_url TEXT;
