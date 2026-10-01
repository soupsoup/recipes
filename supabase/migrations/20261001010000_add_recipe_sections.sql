CREATE TABLE IF NOT EXISTS sections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A recipe can sit in several sections (a chicken burger in Burgers and Chicken).
CREATE TABLE IF NOT EXISTS recipe_sections (
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, section_id)
);
CREATE INDEX IF NOT EXISTS recipe_sections_section_id_idx ON recipe_sections (section_id);

-- The first sections, added by the admin's request. More can be added in the app.
INSERT INTO sections (name, emoji, position) VALUES
  ('Burgers', '🍔', 1),
  ('Chicken', '🍗', 2),
  ('Salad', '🥗', 3),
  ('Desserts', '🍰', 4),
  ('Simple Snacks', '🍿', 5)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sections, recipe_sections FROM anon, authenticated;
