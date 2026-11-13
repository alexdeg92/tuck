-- Formatted notes: notes_doc holds the note as JSON (NoteDoc); NULL for a note saved as plain
-- text, which reads as one paragraph per line. notes stays its plain-text projection and grows
-- to 20 000 characters.
ALTER TABLE tasks DROP CONSTRAINT tasks_notes_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_notes_check CHECK (char_length(notes) <= 20000);
ALTER TABLE tasks ADD COLUMN notes_doc jsonb NULL;
