-- The trash: a deleted task keeps its row (and its checklist items) with deleted_at set, so it
-- can be restored; every normal read filters on deleted_at IS NULL. It also keeps its position,
-- so the UNIQUE (user_id, position) key stays reserved and a restore puts it back in place.
ALTER TABLE tasks ADD COLUMN deleted_at TEXT NULL;
-- The trash view (one user's trashed tasks, newest first) and the live-list filter.
CREATE INDEX tasks_user_deleted_at ON tasks (user_id, deleted_at);
-- The hourly purge looks across every user for rows past the retention period.
CREATE INDEX tasks_trash_purge ON tasks (deleted_at) WHERE deleted_at IS NOT NULL;
