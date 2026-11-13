-- Sign out everywhere: every session token carries the user's session version, and a token
-- whose version is behind the account's is refused. Bumping it revokes every session at once.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0);
