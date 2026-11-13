-- A task's checklist. Items belong to their task (deleted with it); the owner is the task's
-- user, so every query reaches items through tasks.user_id. position orders items within a
-- task (byte order, like tasks), and the UNIQUE constraint is also its index.
-- The 50-item limit is a count, which a CHECK can't express: the repository enforces it.
CREATE TABLE checklist_items (
  id         uuid PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  notes      text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  done       boolean NOT NULL,
  position   text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT checklist_items_task_position_unique UNIQUE (task_id, position)
);
