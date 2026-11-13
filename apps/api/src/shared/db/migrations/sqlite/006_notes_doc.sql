-- migrate: foreign-keys-off
-- Formatted notes: notes_doc holds the note as JSON (NoteDoc); NULL for a note saved as plain
-- text, which reads as one paragraph per line. notes stays its plain-text projection and grows
-- to 20 000 characters. SQLite can't change a CHECK in place, so the table is rebuilt (the
-- runner turns foreign keys off for this file and checks them all before commit), then its
-- indexes are made again.
CREATE TABLE tasks_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes        TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  status       TEXT NOT NULL CHECK (status IN ('todo', 'done')),
  priority     TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date     TEXT NULL CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position     TEXT NOT NULL COLLATE BINARY,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT NULL,
  deleted_at   TEXT NULL,
  notes_doc    TEXT NULL CHECK (notes_doc IS NULL OR json_valid(notes_doc)),
  UNIQUE (user_id, position)
) STRICT;

INSERT INTO tasks_new (id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at, completed_at, deleted_at)
SELECT id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at, completed_at, deleted_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX tasks_user_deleted_at ON tasks (user_id, deleted_at);
CREATE INDEX tasks_trash_purge ON tasks (deleted_at) WHERE deleted_at IS NOT NULL;
