-- A task's checklist. Items belong to their task (deleted with it); the owner is the task's
-- user, so every query reaches items through tasks.user_id. position orders items within a
-- task, like tasks within a user, and UNIQUE (task_id, position) is also its index.
-- The 50-item limit is a count, which a CHECK can't express: the repository enforces it.
CREATE TABLE checklist_items (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  notes      TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  done       INTEGER NOT NULL CHECK (done IN (0, 1)),
  position   TEXT NOT NULL COLLATE BINARY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, position)
) STRICT;
