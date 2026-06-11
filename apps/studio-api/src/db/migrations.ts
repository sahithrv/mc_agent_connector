import type { StudioDb } from "./client";

interface Migration {
  id: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: "001_initial_persistence",
    up: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE UNIQUE INDEX idx_sessions_one_current
        ON sessions(is_current)
        WHERE is_current = 1;

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        type TEXT NOT NULL,
        actor_id TEXT,
        target_id TEXT,
        location TEXT,
        severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX idx_events_session_timestamp
        ON events(session_id, timestamp);
      CREATE INDEX idx_events_type
        ON events(type);
      CREATE INDEX idx_events_actor
        ON events(actor_id);

      CREATE TABLE agent_state (
        agent_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (
          mode IN ('paused', 'routine', 'planning', 'acting', 'failed')
        ),
        role TEXT NOT NULL,
        current_task TEXT,
        health REAL NOT NULL,
        food REAL NOT NULL,
        position TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_agent_state_mode
        ON agent_state(mode);

      CREATE TABLE relationships (
        agent_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        trust REAL NOT NULL,
        loyalty REAL NOT NULL,
        fear REAL NOT NULL,
        tags TEXT NOT NULL,
        PRIMARY KEY (agent_id, target_id)
      );

      CREATE INDEX idx_relationships_target
        ON relationships(target_id);

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_memories_agent_created
        ON memories(agent_id, created_at);
      CREATE INDEX idx_memories_agent_importance
        ON memories(agent_id, importance, created_at);

      CREATE TABLE ai_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        sender_id TEXT NOT NULL,
        recipients TEXT NOT NULL,
        topic TEXT,
        urgency INTEGER CHECK (urgency IS NULL OR urgency BETWEEN 1 AND 5),
        visibility TEXT NOT NULL CHECK (
          visibility IN ('ai', 'human-team', 'recorder', 'public')
        ),
        content TEXT NOT NULL,
        location TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX idx_ai_chat_session_timestamp
        ON ai_chat_messages(session_id, timestamp);
      CREATE INDEX idx_ai_chat_visibility
        ON ai_chat_messages(visibility);

      CREATE TABLE clip_markers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        title TEXT NOT NULL,
        notes TEXT,
        source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX idx_clip_markers_session_timestamp
        ON clip_markers(session_id, timestamp);
    `,
  },
];

export function runMigrations(db: StudioDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => {
      return (row as { id: string }).id;
    }),
  );
  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.id));
  if (pending.length === 0) {
    return;
  }

  const applyPending = db.transaction((migrations: Migration[]) => {
    for (const migration of migrations) {
      db.exec(migration.up);
      db.prepare(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @appliedAt)",
      ).run({
        id: migration.id,
        appliedAt: new Date().toISOString(),
      });
    }
  });

  applyPending(pending);
}

export function listAppliedMigrations(db: StudioDb): string[] {
  return db
    .prepare("SELECT id FROM schema_migrations ORDER BY id")
    .all()
    .map((row) => (row as { id: string }).id);
}
