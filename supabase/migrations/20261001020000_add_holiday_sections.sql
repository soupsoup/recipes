-- Holiday sections, added at the admin's request after the first sections.
INSERT INTO sections (name, emoji, position)
SELECT h.name, h.emoji, (SELECT coalesce(max(position), 0) FROM sections) + h.n
FROM (VALUES
  (1, 'Halloween', '🎃'),
  (2, 'Thanksgiving', '🦃'),
  (3, 'Christmas', '🎄'),
  (4, 'Valentine''s Day', '💝'),
  (5, 'Easter', '🐣')
) AS h(n, name, emoji)
ON CONFLICT (name) DO NOTHING;
