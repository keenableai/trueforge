import { sql } from 'kysely';

import { down, up } from '../../../../src/db/postgres/migrations/20261018_000001_session_last_turn_details';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;
const PREVIOUS_MIGRATION = '20261009_000001_model_message_model_backfill';

describePg('Postgres session last_turn_details migration', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase(PREVIOUS_MIGRATION);
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('backfills id and status from the last turn, leaves the rest null, and drops on rollback', async () => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    const db = env.db;
    const createdBy = JSON.stringify({ subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' });
    const spec = JSON.stringify({ model: { name: 'provider/model' } });

    async function insertSession(sessionId: string, lastTurnId: string | null) {
      await sql`
        INSERT INTO session (
          tenant_id, session_id, created_by_subject, agent_spec, last_turn_id,
          last_activity_timestamp_ms, created_at, updated_at
        )
        VALUES ('tenant-1', ${sessionId}, ${createdBy}::jsonb, ${spec}::jsonb, ${lastTurnId}, 0, now(), now())
      `.execute(db);
    }

    async function insertTurn(sessionId: string, turnId: string, state: object) {
      await sql`
        INSERT INTO turn (
          session_id, turn_id, first_turn_id, ancestor_ids, input, state, checkpoint,
          active_executor_id, created_at, updated_at
        )
        VALUES (
          ${sessionId}, ${turnId}, ${turnId}, ARRAY[]::text[], '[]'::jsonb,
          ${JSON.stringify(state)}::jsonb, '{}'::jsonb, 'executor-1', now(), now()
        )
      `.execute(db);
    }

    await insertSession('paused-session', 'turn-new');
    await insertTurn('paused-session', 'turn-old', {
      status: 'done',
      output: null,
      required_actions: [],
      completed_at: '2026-10-18T00:00:00.000Z',
    });
    await insertTurn('paused-session', 'turn-new', { status: 'paused' });
    await insertSession('empty-session', null);
    await insertSession('missing-turn-session', 'turn-gone');

    await db.transaction().execute(async transaction => {
      await up(transaction);
    });

    const rows = await sql<{ session_id: string; last_turn_details: unknown }>`
      SELECT session_id, last_turn_details FROM session ORDER BY session_id
    `.execute(db);
    expect(rows.rows).toEqual([
      { session_id: 'empty-session', last_turn_details: null },
      { session_id: 'missing-turn-session', last_turn_details: null },
      { session_id: 'paused-session', last_turn_details: { id: 'turn-new', status: 'paused' } },
    ]);

    await db.transaction().execute(async transaction => {
      await down(transaction);
    });

    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'session' AND column_name = 'last_turn_details'
    `.execute(db);
    expect(columns.rows).toEqual([]);
  });
});
