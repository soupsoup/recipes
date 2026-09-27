CREATE TABLE IF NOT EXISTS favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS favorites_recipe_id_idx ON favorites (recipe_id);

-- Same lockdown as the other tables: only the app's server connection can use it.
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON favorites FROM anon, authenticated;
