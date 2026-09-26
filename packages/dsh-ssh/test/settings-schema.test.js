// @dsh-ssh/dsh-ssh — the plugin's settings ROW schema.
// DSH 0.1.7 exposes a settings form only for a row whose exported Config carries at
// least one volatile field, and only volatile paths are editable
// (dsh-settings volatileForm/isVolatilePath). The host dict is that volatile half;
// maxConnections stays deployment tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, HostConfigSchema, HostsConfigSchema, hostsOf, DEFAULT_MAX_CONNECTIONS } from '../src/settings.js';

test('the row schema resolves deployment tuning and wraps the volatile host dict', () => {
  const resolved = Config({ maxConnections: 4 });
  assert.equal(resolved.maxConnections, 4);
  // A volatile field resolves to a cosmokit Volatile reference (the handle the
  // Loader commits live preference writes into); its value is read through get().
  assert.equal(typeof resolved.hosts.get, 'function');
  assert.deepEqual(resolved.hosts.get(), {});
  const empty = Config({});
  assert.equal(empty.maxConnections, DEFAULT_MAX_CONNECTIONS);
});

test('the host dict is the volatile half; maxConnections is not', () => {
  assert.equal(Config.dict.hosts.meta.volatile, true, 'the settings service exposes only volatile fields');
  assert.notEqual(Config.dict.maxConnections.meta.volatile, true);
});

test('HostsConfigSchema resolves a dict of hosts and defaults to {}', () => {
  const resolved = HostsConfigSchema({});
  assert.deepEqual(resolved, {});
  const withHost = HostsConfigSchema({
    h1: { id: 'h1', name: 'box', host: '203.0.113.10', port: 22, user: 'u', auth: { type: 'key', privateKeyPath: '~/.ssh/id' } },
  });
  assert.equal(withHost.h1.user, 'u');
  assert.equal(withHost.h1.auth.type, 'key');
});

test('password auth member accepts the write-only password field', () => {
  const resolved = HostConfigSchema({ id: 'h1', host: 'h', user: 'u', auth: { type: 'password', password: 's3cret' } });
  assert.equal(resolved.auth.type, 'password');
  assert.equal(resolved.auth.password, 's3cret');
});

test('HostConfigSchema is reusable standalone and defaults port/auth', () => {
  const cfg = HostConfigSchema({ id: 'x', host: 'h', user: 'u' });
  assert.equal(cfg.port, 22);
  assert.deepEqual(cfg.auth, { type: 'key' });
});

test('hostsOf tolerates an absent or malformed form value', () => {
  assert.deepEqual(hostsOf(undefined), {});
  assert.deepEqual(hostsOf({}), {});
  assert.deepEqual(hostsOf({ hosts: null }), {});
  assert.deepEqual(hostsOf({ hosts: { a: { id: 'a' } } }), { a: { id: 'a' } });
});
