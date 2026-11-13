-- When a task was completed; null while it's open. Completed tasks list after open ones, most
-- recently completed first. Tasks that were already done get their last update time.
-- (SQLite can't add a table CHECK with ALTER; the domain rule completedAtAfter keeps
-- completed_at set exactly when status = 'done'. Postgres enforces it with a CHECK.)
ALTER TABLE tasks ADD COLUMN completed_at TEXT NULL;
UPDATE tasks SET completed_at = updated_at WHERE status = 'done';
