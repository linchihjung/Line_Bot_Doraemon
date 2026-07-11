ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Taipei';

ALTER TABLE reminders RENAME TO reminders_old;

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  due_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'completed', 'sent', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at_utc TEXT,
  cancelled_at_utc TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO reminders (
  id,
  user_id,
  message,
  due_at_utc,
  timezone,
  status,
  created_at,
  updated_at,
  sent_at_utc,
  cancelled_at_utc
)
SELECT
  id,
  user_id,
  message,
  due_at_utc,
  'Asia/Taipei',
  status,
  created_at,
  updated_at,
  sent_at_utc,
  cancelled_at_utc
FROM reminders_old;

DROP TABLE reminders_old;

CREATE INDEX idx_reminders_user_status ON reminders (user_id, status);
CREATE INDEX idx_reminders_status_due_at_utc ON reminders (status, due_at_utc);
