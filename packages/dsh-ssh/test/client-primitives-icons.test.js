// @dsh-ssh/dsh-ssh — client icon contract across DSH generations.
//
// DSH 0.1.7 renamed the size-suffixed icon atoms of
// @deepseek-ai/dsh-client-ui-primitives to size-neutral glyphs that keep the same
// {size, className} props and the same default drawn size:
//   IconPlusOutline16        → IconPlusOutlineRegular
//   IconChevronDownOutline14 → IconChevronDownOutlineRegular
//   IconInspectOutline12     → IconInspectOutlineRegular
// (evidence: 0.1.7-rc.2 lib/types/icons/index.d.ts exposes only the
// <name>Regular/<name>Medium families; the legacy 0.1.0-rc.6 copy exposes only the
// size-suffixed ones). Reading an icon by its absent name yields `undefined`, and
// React.createElement(undefined) fails the whole subtree — that is how the
// directory-flow panel (remote/local picker) and the settings section broke after the
// host upgrade. client.js therefore resolves every icon by current name first and
// legacy name second, and degrades to an empty glyph when neither exists.
//
// This test pins that contract, hermetically (no DSH process, no network):
//   1. every icon goes through the resolver table, and the table covers the renames;
//   2. the bundle never reads a primitive name outside the two known generations;
//   3. mounting the picker + the settings section yields no undefined element type
//      under the 0.1.7 vocabulary (the regression that broke the picker);
//   4. the legacy vocabulary takes the fallback branch and renders just as cleanly;
//   5. a name absent from both generations degrades instead of breaking its surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT_PATH = new URL('../client.js', import.meta.url);
const SOURCE = readFileSync(CLIENT_PATH, 'utf8');

// Icon names client.js resolves, in declaration order, as exported by
// @deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2.
const ICONS_CURRENT = [
  'IconPlusOutlineRegular',
  'IconEditOutlineRegular',
  'IconTrashOutlineRegular',
  'IconCheckOutlineRegular',
  'IconWarningOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconCloseOutlineRegular',
  'IconLoadingOutlineRegular',
  'IconFolderCloseRegular',
  'IconChevronDownOutlineRegular',
  'IconApiOutlineRegular',
  'IconInspectOutlineRegular',
];

// The same glyphs under the legacy (0.1.0-rc.6) size-suffixed names.
const ICONS_LEGACY = [
  'IconPlusOutline16',
  'IconEditOutline16',
  'IconTrashOutline16',
  'IconCheckOutline16',
  'IconWarningOutline16',
  'IconRefreshOutline16',
  'IconCloseOutline16',
  'IconLoadingOutline16',
  'IconFolderClose16',
  'IconChevronDownOutline14',
  'IconApiOutline14',
  'IconInspectOutline12',
];

// Non-icon atoms, unchanged across the two generations.
const COMPONENTS = ['Button', 'Input', 'Menu', 'Modal', 'Pill', 'StateDot', 'TerminalBlock'];

/** The resolver table client.js must declare, in source order. */
const RESOLVER_PAIRS = ICONS_CURRENT.map((current, index) => ({ current, legacy: ICONS_LEGACY[index] }));

/** The DSH 0.1.7 module namespace: current icon names + the generation-neutral atoms. */
function currentVocabulary() {
  return new Set([...COMPONENTS, ...ICONS_CURRENT]);
}

/** The legacy module namespace: size-suffixed icon names + the same atoms. */
function legacyVocabulary() {
  return new Set([...COMPONENTS, ...ICONS_LEGACY]);
}

/** Minimal react + DOM stubs; the bundle only builds elements while it loads. */
function installBrowserStubs(lastTab) {
  const store = new Map([['dsh-ssh.ui.lastWorkspaceTab', lastTab]]);
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  globalThis.localStorage = localStorage;
  globalThis.window = { localStorage };
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

/**
 * A tiny render runtime: state setters mark the pass dirty, effects run after each
 * pass, and function components expand recursively — enough to reach the element
 * types the panel and the settings section render. An undefined element type (the
 * 0.1.7 failure) is collected instead of thrown, so the assertion can report it.
 * `step` performs one pass so a test can flush promise callbacks in between.
 */
function createRuntime(badTypes, primitiveNames) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;

  function useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
      const next = typeof value === 'function' ? value(hooks[index]) : value;
      if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; }
    };
    return [hooks[index], set];
  }
  function useRef(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { current: initial };
    return hooks[index];
  }
  function useEffect(callback) { effects.push(callback); }
  function createElement(type, props, ...children) {
    if (type === undefined || type === null) badTypes.push(type);
    const primitive = primitiveNames.get(type);
    if (primitive !== undefined) primitiveNames.rendered.push(primitive);
    const next = Object.assign({}, props);
    if (children.length === 1) next.children = children[0];
    else if (children.length > 1) next.children = children;
    return { type, props: next };
  }

  const react = {
    createElement,
    useState,
    useRef,
    useEffect,
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    useContext: () => undefined,
    memo: (component) => component,
    Fragment: 'Fragment',
  };

  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    if (Array.isArray(node)) { for (const child of node) expand(child); return node; }
    const type = node.type;
    if (type === undefined || type === null) return node;
    if (typeof type === 'function' && !primitiveNames.has(type)) return expand(type(node.props));
    expand(node.props.children);
    return node;
  }

  /** One render pass plus its effects; resolves to the element tree. */
  function step(Component, props) {
    cursor = 0;
    effects = [];
    dirty = false;
    const tree = expand({ type: Component, props: props ?? {} });
    const pending = effects;
    effects = [];
    for (const effect of pending) effect();
    return { tree, dirty, pending: false };
  }

  /** Run passes until state settles (bounded), as a caller render would. */
  function mount(Component, props) {
    let tree = null;
    for (let pass = 0; pass < 20; pass++) {
      const result = step(Component, props);
      tree = result.tree;
      if (!result.dirty) return tree;
    }
    return tree;
  }

  return { react, step, mount };
}

/**
 * Load the bundle against one generation's primitive namespace and apply it.
 * `reads` records every primitive name the bundle asked for (so a name this
 * generation does not export is visible instead of silently undefined), and
 * `rendered` records the primitives the mounted tree instantiates (either as a
 * child or as an element-valued prop such as Button.icon).
 */
function loadAndApply(vocabulary, { lastTab = 'local', services } = {}) {
  installBrowserStubs(lastTab);
  // The local tab resolves the directory trio through ctx.get at call time
  // (client.js localDirectoryFace), so the stub context must provide the face.
  const resolvedServices = services ?? { uiWorkspace: localDirectoryFace() };
  const reads = [];
  const primitiveNames = new Map();
  primitiveNames.rendered = [];
  const badTypes = [];
  const table = {};
  for (const name of vocabulary) {
    table[name] = function ReadingPrimitive(props) { return { type: name, props: props ?? {} }; };
    primitiveNames.set(table[name], name);
  }
  // A plain lookup table, not a catch-all proxy: an unknown name must come back
  // undefined exactly as an absent module export does at runtime.
  const primitives = new Proxy(table, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      reads.push(key);
      return target[key];
    },
  });

  const runtime = createRuntime(badTypes, primitiveNames);
  const requireStub = (id) => {
    if (id === 'react') return runtime.react;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error('client.js required an unexpected module: ' + id);
  };

  let loaded = null;
  globalThis.window.__ModuleLoader__ = { load: (options) => { loaded = options; } };
  (0, eval)(SOURCE);
  assert.ok(loaded, 'window.__ModuleLoader__.load was not called');
  assert.equal(loaded.id, '@dsh-ssh/dsh-ssh');
  const plugin = loaded.factory(requireStub);

  const registered = [];
  const ctx = {
    get: (name) => resolvedServices[name],
    effect: (callback) => { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {}; },
    on: () => () => {},
    inject: () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      register: (options, Component) => { registered.push({ options, Component }); return () => {}; },
      inject: (_name, callback) => {
        const value = callback();
        if (value && typeof value.next === 'function') { let step = value.next(); while (!step.done) step = value.next(); }
        return () => {};
      },
    },
    remote: { $mount: () => Promise.resolve(() => {}), $on: () => () => {}, $invoke: () => Promise.resolve() },
  };
  plugin.apply(ctx);
  return { plugin, registered, reads, badTypes, runtime, rendered: primitiveNames.rendered };
}

/** The injected picker face: a recording stand-in for the remote directory RPCs. */
function flowFace() {
  const ok = (value) => Promise.resolve({ ok: true, value });
  return {
    listHosts: () => ok({ hosts: { 'host-1': { id: 'host-1', name: 'demo' } }, revision: 1 }),
    listRemoteDir: () => ok([{ name: 'work', type: 'dir' }]),
    resolveRemoteHome: () => ok('/home/dev'),
    createPlaceholder: () => ok('/placeholder/remote/host-1/L2hvbWUvZGV2'),
    trustHostKey: () => ok(true),
    // The local trio itself is resolved from ctx.get by client.js, so it is absent here.
    t: (key) => key,
  };
}

/**
 * The local directory client service (dsh-client-ui-workspace UiWorkspaceService):
 * one directory child, so the local tab renders its folder rows too.
 */
function localDirectoryFace() {
  return {
    listDirectory: () => Promise.resolve({
      path: '/home/dev', home: '/home/dev',
      crumbs: [{ name: '/', path: '/' }, { name: 'dev', path: '/home/dev' }],
      entries: [{ name: 'work', path: '/home/dev/work', type: 'dir' }],
      truncated: false,
    }),
    createDirectory: (path, name) => Promise.resolve(path + '/' + name),
    pickDirectory: () => Promise.resolve('/picked'),
  };
}

/** Drain every microtask the bundle's promise chains queued (adoption costs a few). */
async function flushMicrotasks() {
  for (let tick = 0; tick < 8; tick++) await Promise.resolve();
}

/** Props the picker owner hands its directoryFlow occupant. */
function flowProps(loaded) {
  const flow = loaded.registered.find((entry) => entry.options.name === 'sidebar.workspaces.directoryFlow');
  assert.ok(flow, 'the plugin must register the sidebar directoryFlow occupant');
  return Object.assign({}, flow.options.inject(), {
    open: true, busy: false, onPicked: () => {}, onCancel: () => {}, onError: () => {},
  });
}

/** Mount the picker for a bounded number of passes, flushing microtasks between them. */
async function mountFlowAsync(loaded, passes = 8) {
  const flow = loaded.registered.find((entry) => entry.options.name === 'sidebar.workspaces.directoryFlow');
  const props = flowProps(loaded);
  let tree = null;
  for (let pass = 0; pass < passes; pass++) {
    tree = loaded.runtime.step(flow.Component, props).tree;
    await flushMicrotasks();
  }
  return tree;
}

test('every icon goes through the current-then-legacy resolver table', () => {
  const pairs = [...SOURCE.matchAll(/resolveIcon\("([A-Za-z0-9]+)",\s*"([A-Za-z0-9]+)"\)/g)]
    .map((match) => ({ current: match[1], legacy: match[2] }));
  assert.deepEqual(pairs, RESOLVER_PAIRS, 'the icon resolver table must cover the renamed glyphs');

  // A direct `primitives.IconX` read is exactly the 0.1.7 breakage: the name is
  // undefined in the other generation, so it must never come back.
  assert.equal(/primitives\.Icon/.test(SOURCE), false, 'icons must be read through resolveIcon, not directly');

  // Outside the resolver literals, no size-suffixed icon identifier may survive in
  // code (comments keep the mapping for readers).
  const withoutResolverCalls = SOURCE.replace(/resolveIcon\("[A-Za-z0-9]+",\s*"[A-Za-z0-9]+"\)/g, '');
  for (const line of withoutResolverCalls.split('\n')) {
    if (line.trimStart().startsWith('//')) continue;
    const stale = line.match(/Icon[A-Za-z]+(?:Outline|Fill)?1[0-9]\b/);
    assert.equal(stale, null, 'stale size-suffixed icon identifier: ' + line.trim());
  }
});

test('the bundle reads only primitive names that exist in one of the two generations', () => {
  const known = new Set([...COMPONENTS, ...ICONS_CURRENT, ...ICONS_LEGACY]);
  for (const vocabulary of [currentVocabulary(), legacyVocabulary()]) {
    const { reads } = loadAndApply(vocabulary);
    const unknown = reads.filter((name) => !known.has(name));
    assert.deepEqual(unknown, [], 'client.js read a primitive name outside both DSH generations');
  }
});

test('0.1.7: the settings section renders without undefined element types', () => {
  const loaded = loadAndApply(currentVocabulary());
  const section = loaded.registered.find((entry) => entry.options.id === 'ssh-hosts');
  assert.ok(section, 'the settings section must be registered');
  loaded.runtime.mount(section.Component, Object.assign({}, section.options.inject(), {
    useSshHosts: (selector) => selector({
      status: 'ready', hosts: [], writable: true, form: null, pendingDelete: null,
      trustHostKey: null, error: null, notice: null, deleting: false,
    }),
    load: () => {},
    t: (key) => key,
  }));
  assert.deepEqual(loaded.badTypes, [], 'the settings section rendered an undefined element type');
  assert.ok(loaded.rendered.includes('IconPlusOutlineRegular'), 'the settings add icon must render');
  assert.equal(loaded.rendered.some((name) => ICONS_LEGACY.includes(name)), false,
    'a legacy icon rendered although 0.1.7 exports the current name');
});

test('0.1.7: the picker renders both tabs and its folder rows without undefined element types', async () => {
  for (const lastTab of ['local', 'remote']) {
    const loaded = loadAndApply(currentVocabulary(), { lastTab });
    await mountFlowAsync(loaded);
    assert.deepEqual(loaded.badTypes, [],
      'the directory-flow panel rendered an undefined element type (default tab: ' + lastTab + ')');
    assert.equal(loaded.rendered.some((name) => ICONS_LEGACY.includes(name)), false,
      'a legacy icon rendered although 0.1.7 exports the current name (default tab: ' + lastTab + ')');
  }
  // The local tab's folder rows carry the folder icon — the glyph that used to be
  // read by its absent 0.1.7-era name.
  const local = loadAndApply(currentVocabulary(), { lastTab: 'local' });
  await mountFlowAsync(local);
  assert.ok(local.rendered.includes('IconFolderCloseRegular'), 'the local tab must render its folder rows');
});

test('legacy generation: the picker renders through the size-suffixed fallback names', async () => {
  const loaded = loadAndApply(legacyVocabulary(), { lastTab: 'local' });
  await mountFlowAsync(loaded);
  assert.deepEqual(loaded.badTypes, [], 'the fallback path rendered an undefined element type');
  assert.ok(loaded.rendered.includes('IconLoadingOutline16'), 'the fallback must render the legacy loading icon');
  assert.ok(loaded.rendered.includes('IconFolderClose16'), 'the fallback must render the legacy folder icon');
  assert.equal(loaded.rendered.some((name) => ICONS_CURRENT.includes(name)), false,
    'a current icon rendered although the legacy generation is the one mounted');
});

test('an icon absent from both generations degrades instead of breaking its surface', async () => {
  const loaded = loadAndApply(new Set(COMPONENTS), { lastTab: 'local' });
  await mountFlowAsync(loaded);
  assert.deepEqual(loaded.badTypes, [], 'a missing icon must render as an empty glyph, never as an undefined type');
  assert.equal(loaded.rendered.some((name) => name.startsWith('Icon')), false,
    'no icon may render when neither generation exports it');
});
