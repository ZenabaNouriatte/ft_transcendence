PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS visits_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO visits_counter(id, count)
VALUES (1, 0)
ON CONFLICT(id) DO NOTHING;
