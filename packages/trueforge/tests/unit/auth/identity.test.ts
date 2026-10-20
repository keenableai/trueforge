import { Hono } from 'hono';
import {
  canWriteSandboxEnvironment,
  hasAdminRole,
  requestContextFromCreatedBySubject,
  resolveRequestContext,
  STANDALONE_REQUEST_CONTEXT,
  TRUEFOUNDRY_TENANT_ADMIN_ROLE,
} from '../../../src/auth/identity';
import { getTrueForgeAuthMode, TrueForgeAuthMode } from '../../../src/config';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getTrueForgeAuthMode: jest.fn(() => actual.TrueForgeAuthMode.Standalone),
  };
});

describe('STANDALONE_REQUEST_CONTEXT', () => {
  it('has the fixed standalone identity shape', () => {
    expect(STANDALONE_REQUEST_CONTEXT).toEqual({
      tenant_id: 'default',
      subject: {
        id: 'trueforge-default',
        type: 'user',
        display_name: 'trueforge-default',
      },
      roles: ['admin'],
      user_credential: null,
    });
  });
});

describe('requestContextFromCreatedBySubject', () => {
  it('builds request identity from a persisted creator snapshot', () => {
    const rc = requestContextFromCreatedBySubject({
      tenant_id: 'acme',
      created_by_subject: {
        subject_id: 'alice',
        subject_type: 'user',
        subject_display_name: 'Alice',
      },
    });
    expect(rc.tenant_id).toBe('acme');
    expect(rc.subject).toEqual({ id: 'alice', type: 'user', display_name: 'Alice' });
    expect(rc.roles).toEqual([]);
    expect(rc.user_credential).toBeNull();
  });
});

describe('hasAdminRole', () => {
  // Unit tests run under STANDALONE=true (.env.test) → mode Standalone.
  it('treats admin as admin and other roles as non-admin in standalone', () => {
    expect(hasAdminRole({ roles: ['admin'] })).toBe(true);
    expect(hasAdminRole({ roles: ['everyone'] })).toBe(false);
    expect(hasAdminRole(STANDALONE_REQUEST_CONTEXT)).toBe(true);
  });
});

describe('canWriteSandboxEnvironment', () => {
  afterEach(() => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.Standalone);
  });

  it('allows create for any subject and update/delete only for the creator in standalone', () => {
    const alice = { roles: ['admin'], subject: { id: 'alice', type: 'user', display_name: 'alice' } };
    const bob = { roles: ['admin'], subject: { id: 'bob', type: 'user', display_name: 'bob' } };
    expect(canWriteSandboxEnvironment({ requestContext: alice })).toBe(true);
    expect(canWriteSandboxEnvironment({ requestContext: alice, existingCreatorSubjectId: 'alice' })).toBe(true);
    expect(canWriteSandboxEnvironment({ requestContext: bob, existingCreatorSubjectId: 'alice' })).toBe(false);
  });

  it('allows only tenant-admin writes in TrueFoundry mode', () => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    const admin = {
      roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE],
      subject: { id: 'admin', type: 'user', display_name: 'admin' },
    };
    const alice = { roles: ['everyone'], subject: { id: 'alice', type: 'user', display_name: 'alice' } };
    expect(canWriteSandboxEnvironment({ requestContext: alice })).toBe(false);
    expect(canWriteSandboxEnvironment({ requestContext: alice, existingCreatorSubjectId: 'alice' })).toBe(false);
    expect(canWriteSandboxEnvironment({ requestContext: admin })).toBe(true);
    expect(canWriteSandboxEnvironment({ requestContext: admin, existingCreatorSubjectId: 'alice' })).toBe(true);
  });
});

describe('resolveRequestContext', () => {
  it('returns request_context when set by auth middleware', async () => {
    const app = new Hono();
    app.get('/', c => {
      c.set('request_context', STANDALONE_REQUEST_CONTEXT);
      return c.json(resolveRequestContext(c));
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STANDALONE_REQUEST_CONTEXT);
  });

  it('throws when request_context is missing', async () => {
    const app = new Hono();
    app.get('/', c => {
      try {
        resolveRequestContext(c);
        return c.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        return c.json({ error: message }, 500);
      }
    });

    const res = await app.request('/');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'RequestContext missing; auth middleware did not run',
    });
  });
});
