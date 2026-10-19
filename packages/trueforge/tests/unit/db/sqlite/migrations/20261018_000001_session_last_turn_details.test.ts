import { sql } from 'kysely';

import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { down, up } from '../../../../../src/db/sqlite/migrations/20261018_000001_session_last_turn_details';

describe('SQLite session last_turn_details migration', () => {
  it('backfills id and status from the last turn, leaves the rest null, and drops on rollback', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE session (
          session_id TEXT PRIMARY KEY,
          last_turn_id TEXT
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE turn (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          state BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id)
        ) STRICT
      `.execute(db);
      await sql`
        INSERT INTO session (session_id, last_turn_id)
        VALUES ('paused-session', 'turn-new'), ('empty-session', NULL), ('missing-turn-session', 'turn-gone')
      `.execute(db);
      await sql`
        INSERT INTO turn (session_id, turn_id, state)
        VALUES
          ('paused-session', 'turn-old', jsonb(${JSON.stringify({ status: 'done' })})),
          ('paused-session', 'turn-new', jsonb(${JSON.stringify({ status: 'paused' })}))
      `.execute(db);

      await up(db);

      const rows = await sql<{ session_id: string; last_turn_details: unknown }>`
        SELECT session_id, json(last_turn_details) AS last_turn_details FROM session ORDER BY session_id
      `.execute(db);
      expect(rows.rows).toEqual([
        { session_id: 'empty-session', last_turn_details: null },
        { session_id: 'missing-turn-session', last_turn_details: null },
        { session_id: 'paused-session', last_turn_details: { id: 'turn-new', status: 'paused' } },
      ]);

      await down(db);

      const columns = await sql<{ name: string }>`
        SELECT name FROM pragma_table_info('session') WHERE name = 'last_turn_details'
      `.execute(db);
      expect(columns.rows).toEqual([]);
    } finally {
      await db.destroy();
    }
  });
});
