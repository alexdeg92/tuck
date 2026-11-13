-- Which demo-content keys each account has been given, so a boot adds each demo task once,
-- ever: a task the user deleted or edited is never restored. Read only by the demo seed.
CREATE TABLE demo_content (
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key       TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 100),
  seeded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
) STRICT;

-- A demo account made by the first seed (before this table) already has the first six demo
-- tasks: record them here, in the same transaction as the table, so no boot ever has to guess
-- (seed.ts adds every key not recorded). Same keys as FIRST_SEED_KEYS in demoContent.ts.
INSERT INTO demo_content (user_id, key, seeded_at)
SELECT users.id, first_seed.key, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users
CROSS JOIN (
  SELECT 'quarterly-review-deck' AS key
  UNION ALL SELECT 'search-pr-review'
  UNION ALL SELECT 'offsite-flights'
  UNION ALL SELECT 'weekly-groceries'
  UNION ALL SELECT 'renew-passport'
  UNION ALL SELECT 'dentist-reschedule'
) AS first_seed
WHERE users.email = 'demo@example.com';
