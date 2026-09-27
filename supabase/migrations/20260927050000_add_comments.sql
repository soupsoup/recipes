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

-- Same lockdown as the other tables: only the app's server connection can use it.
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON comments FROM anon, authenticated;
