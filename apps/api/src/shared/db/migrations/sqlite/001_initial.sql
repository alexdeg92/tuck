-- Users own tasks. Emails are stored lower-cased (the contract normalises them).
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
) STRICT;

-- position is a fractional-indexing key compared byte by byte; the UNIQUE constraint
-- also serves as the (user_id, position) index that every list query walks.
CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes      TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  status     TEXT NOT NULL CHECK (status IN ('todo', 'done')),
  priority   TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date   TEXT NULL CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position   TEXT NOT NULL COLLATE BINARY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, position)
) STRICT;
