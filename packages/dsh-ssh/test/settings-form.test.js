// @dsh-ssh/dsh-ssh — the settings FORM seam (DSH 0.1.7).
// Host CRUD addresses this plugin's settings form: the Loader row that mounted the
// package (resolveOwnEntryId), read through describe() and written through mutate()
// with the revision describe() returned. A stale revision must surface as
// SETTINGS_CONFLICT so the settings page can prompt a refresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { HOST_ENTRY_FALLBACK_ID, resolveOwnEntryId, storedHosts } from '../src/settings.js';
import { SshRemoteService } from '../src/remote.js';

/** One Loader row: id + package name + the fiber it is bound to. */
function row(id, name, extra = {}) {
  return { options: { id, name, ...(extra.options ?? {}) }, fiber: extra.fiber, disabled: extra.disabled };
}

test('resolveOwnEntryId prefers the row bound to this fiber', () => {
  const fiber = { uid: 1 };
  const ctx = {
    fiber,
    loader: { entries: () => [row('other-id', '@dsh-ssh/dsh-ssh', { fiber: { uid: 2 } }), row('own-id', '@dsh-ssh/dsh-ssh', { fiber })] },
  };
  assert.equal(resolveOwnEntryId(ctx, '@dsh-ssh/dsh-ssh'), 'own-id');
});

test('resolveOwnEntryId falls back to an enabled row and ignores disabled ones', () => {
  const ctx = {
    fiber: { uid: 1 },
    loader: { entries: () => [row('disabled-id', '@dsh-ssh/dsh-ssh', { disabled: true }), row('enabled-id', '@dsh-ssh/dsh-ssh')] },
  };
  assert.equal(resolveOwnEntryId(ctx, '@dsh-ssh/dsh-ssh'), 'enabled-id');
  assert.equal(resolveOwnEntryId({ fiber: { uid: 1 } }, '@dsh-ssh/dsh-ssh'), undefined);
});

test('storedHosts reads the row value through the settings service', () => {
  const service = { describe: () => [{ ns: HOST_ENTRY_FALLBACK_ID, value: { hosts: { h1: { id: 'h1' } } } }] };
  assert.deepEqual(storedHosts({ get: () => service }), { h1: { id: 'h1' } });
  assert.deepEqual(storedHosts({ settings: service }), { h1: { id: 'h1' } });
  assert.deepEqual(storedHosts({}), {});
  assert.deepEqual(storedHosts({ get: () => ({ describe: () => { throw new Error('boom'); } }) }), {});
});

/** One settings form double: describe() value/revision over a mutable hosts dict. */
function makeForm(hosts) {
  const id = HOST_ENTRY_FALLBACK_ID;
  const doc = { hosts: { ...hosts } };
  let revision = 0;
  const writes = [];
  return {
    id,
    writes,
    api: {
      id,
      describe: () => [{ ns: id, revision, value: doc }],
      writable: true,
      async mutate(ns, ops, expectedRevision) {
        if (expectedRevision !== undefined && expectedRevision !== revision) {
          const error = new Error('changed since it was read');
          error.name = 'SettingsConflictError';
          error.code = 'SETTINGS_CONFLICT';
          throw error;
        }
        assert.equal(ns, id);
        writes.push({ ops, expectedRevision });
        for (const op of ops) if (op.op === 'set' && op.path.length === 1 && op.path[0] === 'hosts') doc.hosts = { ...op.value };
        revision += 1;
      },
    },
    hosts: () => doc.hosts,
    revision: () => revision,
  };
}

function serviceWith(form) {
  const ctx = new Context();
  const svc = new SshRemoteService(ctx, { testConnection: async () => ({ ok: false, error: 'x' }) });
  svc.setSettingsApi(form.api);
  return { ctx, svc };
}

test('listHosts reports the form value, revision and writability', () => {
  const form = makeForm({ h1: { id: 'h1', name: 'box', host: 'h', user: 'u', auth: { type: 'key' } } });
  const { ctx, svc } = serviceWith(form);
  const listed = svc.listHosts();
  assert.equal(listed.hosts.h1.name, 'box');
  assert.equal(listed.revision, 0);
  assert.equal(listed.writable, true);
  ctx.dispose?.();
});

test('saveHost writes the whole host dict as one set-op with the revision it read', async () => {
  const form = makeForm({ hA: { id: 'hA', name: 'A', host: 'a', port: 22, user: 'u', auth: { type: 'key' } } });
  const { ctx, svc } = serviceWith(form);
  await svc.saveHost('hB', { id: 'hB', name: 'B', host: 'b', port: 22, user: 'u', auth: { type: 'key' } }, 0);
  assert.deepEqual(Object.keys(form.hosts()).sort(), ['hA', 'hB']);
  assert.equal(form.hosts().hB.name, 'B');
  assert.equal(form.writes.length, 1);
  assert.equal(form.writes[0].expectedRevision, 0);
  assert.equal(form.writes[0].ops[0].path[0], 'hosts');
  ctx.dispose?.();
});

test('deleteHost removes the id and keeps the rest of the dict', async () => {
  const form = makeForm({
    hA: { id: 'hA', name: 'A', host: 'a', port: 22, user: 'u', auth: { type: 'key' } },
    hB: { id: 'hB', name: 'B', host: 'b', port: 22, user: 'u', auth: { type: 'key' } },
  });
  const { ctx, svc } = serviceWith(form);
  await svc.deleteHost('hA', 0);
  assert.deepEqual(Object.keys(form.hosts()), ['hB']);
  ctx.dispose?.();
});

test('a stale revision surfaces as SETTINGS_CONFLICT with a refresh hint', async () => {
  const form = makeForm({ h1: { id: 'h1', name: 'A', host: 'a', port: 22, user: 'u', auth: { type: 'key' } } });
  const { ctx, svc } = serviceWith(form);
  await assert.rejects(
    () => svc.saveHost('h1', { name: 'A2' }, 7),
    /SETTINGS_CONFLICT/,
  );
  assert.deepEqual(form.hosts().h1.name, 'A', 'a refused write must not change the stored dict');
  ctx.dispose?.();
});

test('a missing form value reads as an empty host set, not as an error', () => {
  const ctx = new Context();
  const svc = new SshRemoteService(ctx, { testConnection: async () => ({ ok: false, error: 'x' }) });
  svc.setSettingsApi({ id: HOST_ENTRY_FALLBACK_ID, describe: () => [], writable: true, mutate: async () => {} });
  const listed = svc.listHosts();
  assert.deepEqual(listed.hosts, {});
  assert.equal(listed.revision, 0);
  ctx.dispose?.();
});
