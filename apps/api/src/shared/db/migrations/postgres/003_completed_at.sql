-- When a task was completed; null while it's open. Completed tasks list after open ones, most
-- recently completed first. Tasks that were already done get their last update time.
ALTER TABLE tasks ADD COLUMN completed_at timestamptz NULL;
UPDATE tasks SET completed_at = updated_at WHERE status = 'done';
ALTER TABLE tasks
  ADD CONSTRAINT tasks_completed_at_matches_status
  CHECK ((status = 'done') = (completed_at IS NOT NULL));
