// @dsh-ssh/dsh-ssh — local directory face resolution in client.js.
// The local tab's listDirectory/createDirectory/pickDirectory must be resolved from
// whichever client service provides them: uiWorkspace (dsh-client-ui-workspace/lib/
// client.js UiWorkspaceService) in current DSH builds, or the Workspace Controller
// face ctx.workspaces in builds that still carry the trio there. Binding one face
// statically makes the other throw "<face>.<method> is not a function" and breaks
// picking a local workspace folder.
//
// The bundle runs under the browser module loader, so the test supplies the same
// window/document/react stubs client-selfcheck.mjs uses and never touches a network
// or a real DSH process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT_PATH = new URL('../client.js', import.meta.url);

/** Minimal react face: the bundle only builds elements, never renders them here. */
const element = (type, props, ...children) => ({ type, props, children });
const reactStub = {
  createElement: element,
  createContext: () => ({ Provider: element, Consumer: element }),
  useContext: () => undefined,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  useReducer: (_reducer, initial) => [initial, () => {}],
  Fragment: 'Fragment',
  memo: (component) => component,
};
const primitivesStub = new Proxy({}, {
  get: (_target, key) => (typeof key === 'string' ? (props) => element(key, props) : undefined),
});
const requireStub = (id) => {
  if (id === 'react') return reactStub;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
  throw new Error('client.js required an unexpected module: ' + id);
};

/** Install the browser globals the bundle touches while it loads and applies. */
function installBrowserStubs() {
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({
      style: {}, dataset: {}, textContent: '', appendChild: () => {}, setAttribute: () => {}, select: () => {},
    }),
    execCommand: () => true,
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
  };
}

/** Load the bundle and return its plugin face ({ apply, inject }). */
function loadClientPlugin() {
  installBrowserStubs();
  let loaded = null;
  window.__ModuleLoader__ = { load: (options) => { loaded = options; } };
  (0, eval)(readFileSync(CLIENT_PATH, 'utf8'));
  assert.ok(loaded, 'window.__ModuleLoader__.load was not called');
  assert.equal(loaded.id, '@dsh-ssh/dsh-ssh');
  return loaded.factory(requireStub);
}

/** Drain a slots.inject generator callback the way the slot registry does. */
function drain(value) {
  if (value && typeof value.next === 'function') {
    let step = value.next();
    while (!step.done) step = value.next();
  }
  return value;
}

/**
 * Apply the plugin to a stubbed client context whose ctx.get answers with the
 * given services, and return the local tab's injected directory face.
 * @param services - name → service face, as ctx.get would resolve them.
 */
function applyAndCaptureFace(services) {
  const registered = [];
  const ctx = {
    get: (name) => services[name],
    effect: (callback) => { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {}; },
    on: () => () => {},
    inject: () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      register: (options) => { registered.push(options); return () => {}; },
      inject: (_name, callback) => { drain(callback()); return () => {}; },
    },
    remote: { $mount: () => Promise.resolve(() => {}), $on: () => () => {}, $invoke: () => Promise.resolve() },
  };
  loadClientPlugin().apply(ctx);
  const flow = registered.find((options) => options.name === 'sidebar.workspaces.directoryFlow');
  assert.ok(flow, 'the plugin must register the sidebar directoryFlow occupant');
  return flow.inject();
}

/** A recording stand-in for one directory service face. */
function recordingFace(calls, label) {
  return {
    listDirectory: (path, signal) => {
      calls.push([label + '.listDirectory', path, signal instanceof AbortSignal]);
      return Promise.resolve({ path: path ?? '/home/dev', home: '/home/dev', crumbs: [], entries: [], truncated: false });
    },
    createDirectory: (path, name) => {
      calls.push([label + '.createDirectory', path, name]);
      return Promise.resolve(path + '/' + name);
    },
    pickDirectory: () => {
      calls.push([label + '.pickDirectory']);
      return Promise.resolve('/picked');
    },
  };
}

test('local directory trio resolves through uiWorkspace (Workspace Controller face lacks it)', async () => {
  const calls = [];
  const uiWorkspace = recordingFace(calls, 'uiWorkspace');
  // Current DSH: ctx.workspaces carries workspace commands only, no directory trio.
  const workspaces = { create: () => {}, rename: () => {}, delete: () => {}, list: { getSnapshot: () => ({ items: [] }) } };

  const face = applyAndCaptureFace({ uiWorkspace, workspaces });
  assert.equal(typeof face.listDirectory, 'function');
  assert.equal(typeof face.createDirectory, 'function');
  assert.equal(typeof face.pickDirectory, 'function');

  await face.listDirectory('/tmp', new AbortController().signal);
  await face.createDirectory('/tmp', 'demo');
  await face.pickDirectory();

  assert.deepEqual(calls, [
    ['uiWorkspace.listDirectory', '/tmp', true],
    ['uiWorkspace.createDirectory', '/tmp', 'demo'],
    ['uiWorkspace.pickDirectory'],
  ]);
});

test('local directory trio falls back to the legacy workspaces face', async () => {
  const calls = [];
  const workspaces = recordingFace(calls, 'workspaces');

  const face = applyAndCaptureFace({ workspaces });
  await face.listDirectory(undefined, new AbortController().signal);

  assert.deepEqual(calls, [['workspaces.listDirectory', undefined, true]]);
});

test('missing directory service rejects with a readable error, not a TypeError', async () => {
  const face = applyAndCaptureFace({});

  await assert.rejects(
    () => face.listDirectory('/tmp'),
    /workspace directory service unavailable: uiWorkspace\.listDirectory is not mounted/,
  );
  await assert.rejects(() => face.pickDirectory(), /uiWorkspace\.pickDirectory is not mounted/);
});

test('the plugin fiber does not require the Workspace Controller service', () => {
  const plugin = loadClientPlugin();
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'remote']);
  assert.ok(!plugin.inject.includes('workspaces'), 'the workspace directory face is resolved at call time, not injected');
});
