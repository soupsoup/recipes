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

ALTER TABLE contest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_winners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contest_entries, contest_winners FROM anon, authenticated;
