-- Users own tasks. Emails are stored lower-cased (the contract normalises them).
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL CHECK (password_hash <> ''),
  created_at    timestamptz NOT NULL,
  CONSTRAINT users_email_unique UNIQUE (email)
);

-- position is a fractional-indexing key. COLLATE "C" compares it byte by byte, like SQLite's
-- BINARY; a locale collation would order the keys differently. The UNIQUE constraint is also
-- the (user_id, position) index that every list query walks.
CREATE TABLE tasks (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes      text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
  status     text NOT NULL CHECK (status IN ('todo', 'done')),
  priority   text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date   date NULL,
  position   text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT tasks_user_position_unique UNIQUE (user_id, position)
);
