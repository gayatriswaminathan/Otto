-- Otto — D1 (SQLite) schema.
-- Three tables: snapshots (raw captured ProgramState), rollups (generated
-- status reports), decisions (intake/triage decision log).
-- Apply with: wrangler d1 execute <DB> --file=db/schema.sql

PRAGMA foreign_keys = ON;

-- Raw ProgramState captures, one row per fetch from a source (e.g. Jira).
CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program     TEXT    NOT NULL,                       -- program / project name
  source      TEXT    NOT NULL,                       -- 'jira', 'linear', ...
  captured_at TEXT    NOT NULL DEFAULT (datetime('now')),
  state_json  TEXT    NOT NULL                         -- serialized ProgramState
);
CREATE INDEX IF NOT EXISTS idx_snapshots_program_time
  ON snapshots (program, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_source
  ON snapshots (source, captured_at DESC);

-- Generated rollups (status reports) derived from a snapshot.
CREATE TABLE IF NOT EXISTS rollups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  program      TEXT    NOT NULL,
  generated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  readiness    REAL,                                   -- 0..1 readiness metric
  momentum     REAL,                                   -- 0..1 momentum metric
  html         TEXT,                                   -- rendered HTML rollup
  json         TEXT                                    -- structured analysis JSON
);
CREATE INDEX IF NOT EXISTS idx_rollups_program_time
  ON rollups (program, generated_at DESC);

-- Intake / triage decision log (audit trail).
CREATE TABLE IF NOT EXISTS decisions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  program TEXT    NOT NULL,
  ts      TEXT    NOT NULL DEFAULT (datetime('now')),  -- decision timestamp
  summary TEXT    NOT NULL,                             -- one-line decision
  detail  TEXT                                          -- full context / rationale
);
CREATE INDEX IF NOT EXISTS idx_decisions_program_time
  ON decisions (program, ts DESC);

-- Observability: one row per traced run (route handler / cron / span).
-- Written by reporting/store.mjs saveRun(); fed by reporting/observability.mjs trace().
-- No PII — only ids, route names, ok flag, durations.
CREATE TABLE IF NOT EXISTS runs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT    NOT NULL,                              -- correlates spans in one run
  route   TEXT,                                          -- 'rollup', 'scheduled', span name
  source  TEXT,                                          -- 'jira', 'fixture', 'cron', ...
  program TEXT,                                          -- program / project name
  ok      INTEGER NOT NULL DEFAULT 1,                    -- 1 = success, 0 = failure
  ms      REAL,                                          -- duration in milliseconds
  ts      TEXT    NOT NULL DEFAULT (datetime('now'))     -- when the run completed
);
CREATE INDEX IF NOT EXISTS idx_runs_program_time
  ON runs (program, ts DESC);
CREATE INDEX IF NOT EXISTS idx_runs_run_id
  ON runs (run_id, ts DESC);
