
// PREREQ: run from the repo root (reads packages/dsh-ssh/client.js). No remote/network needed.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const code = readFileSync('packages/dsh-ssh/client.js', 'utf8');

// minimal react + primitives stubs so the factory body parses and runs
const element = (type, props, ...children) => ({ type, props, children });
const reactStub = {
  createElement: element,
  useState: () => [{}, () => {}],
  useEffect: () => {},
  useRef: () => ({}),
  Fragment: 'Fragment',
};
const required = new Set();
const primitivesStub = new Proxy({}, {
  get: (t, key) => {
    if (typeof key !== 'string') return undefined;
    return (props) => element(key, props);
  },
});
const requireStub = (id) => {
  required.add(id);
  if (id === 'react') return reactStub;
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
  throw new Error('client.js required an unexpected module: ' + id);
};

globalThis.window = {};
let loaded = null;
window.__ModuleLoader__ = { load: (opts) => { loaded = opts; } };

// eval the file as a classic script (it only touches window.__ModuleLoader__)
(0, eval)(code);

assert.ok(loaded, 'window.__ModuleLoader__.load was not called');
assert.equal(loaded.id, '@dsh-ssh/dsh-ssh');
const mod = loaded.factory(requireStub);
assert.equal(typeof mod.apply, 'function', 'factory must export apply');
assert.deepEqual([...mod.inject], ['slots', 'locale', 'remote']);
assert.deepEqual([...required], ['react', '@deepseek-ai/dsh-client-ui-primitives']);

// The inline Typert client descriptors must mirror lib/typert-contribution.js
// (method + wire parameter list), or saveHost/deleteHost arg counts drift and
// the gateway rejects the call. Rebuild the expected lines from the lib copy
// and assert the client.js source contains them verbatim.
const lib = await import('../lib/typert-contribution.js');
const sq = (value) => "'" + String(value).replaceAll("'", "\\'") + "'";
for (const d of lib.CLIENT_TYPERT_REMOTE.descriptors) {
  const params = d.parameters.map((p) => p.name);
  const resultType = d.result.typeSymbol.split('#')[1];
  const line = 'remoteDescriptor(' + sq(d.method) + ', [' + params.map(sq).join(', ') + '], ' + sq(resultType) + ')';
  assert.ok(code.includes(line), 'client.js must inline descriptor line: ' + line);
}

// The combined picker must be registered into BOTH holes at
// priority -1 (single slots are unique per priority; lowest renders — the
// stock browse picker occupies default priority 0), using the nested
// slots.inject generator pattern (mirrors dsh-client-ui-directory-picker-browse).
for (const hole of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) {
  assert.ok(code.includes(hole), 'client.js must reference directoryFlow hole: ' + hole);
}
const priorityUses = code.match(/priority:\s*-1/g) ?? [];
assert.equal(priorityUses.length, 3, 'directoryFlow x2 + bash tool.call.toolview must carry priority: -1 (shadow the stock registrations)');
assert.ok(code.includes('function DirectoryFlowCombined'), 'client.js must define the DirectoryFlowCombined occupant');
assert.ok(code.includes('function LocalFlowBody'), 'client.js must define the local-tab browser body');
assert.ok(code.includes('function RemoteFlowBody'), 'client.js must define the remote-tab flow body');
// The local tab must resolve the directory trio from whichever client service
// provides it: uiWorkspace carries listDirectory/createDirectory/pickDirectory
// (dsh-client-ui-workspace/lib/client.js), while the Workspace Controller face
// ctx.workspaces carries only create/rename/delete/list
// (dsh-api-workspace-controller/lib/client.js). Resolving by name at call time
// keeps both DSH builds working; hard-coding one face makes the other throw
// "<face>.<method> is not a function".
assert.ok(code.includes('var localDirectoryFace = function ()'), 'client.js must resolve the local directory face at call time');
assert.ok(code.includes('ctx.get(names[i])'), 'client.js must read the directory face through ctx.get (inject-free)');
for (const method of ['listDirectory', 'createDirectory', 'pickDirectory']) {
  assert.ok(code.includes(method + ": localCall('" + method + "')"), 'client.js must route ' + method + ' through localCall');
}
assert.ok(!code.includes('ctx.workspaces.listDirectory'), 'client.js must not bind directory listing to the Workspace Controller face');
assert.ok(code.includes('ctx.slots.inject("conversation.hero.workspace.directoryFlow"'), 'nested slots.inject pattern expected for hero hole');
assert.ok(code.includes('ctx.slots.inject("sidebar.workspaces.directoryFlow"'), 'nested slots.inject pattern expected for sidebar hole');
assert.ok(code.includes('ctx.locale.register("workspace.ssh"'), 'workspace.ssh locale must be registered');

// Icons must go through the current-then-legacy resolver: DSH 0.1.7 renamed the
// size-suffixed atoms (IconPlusOutline16) to size-neutral glyphs
// (IconPlusOutlineRegular/…Medium) with the same {size, className} props. A
// hard-coded name is undefined in the other generation, and
// React.createElement(undefined) takes the whole surface down — the directory-flow
// panel and the settings section both broke that way on 0.1.7.
assert.ok(code.includes('function resolveIcon(current, legacy)'), 'client.js must declare the icon resolver');
assert.equal(/primitives\.Icon/.test(code), false, 'client.js must resolve icons through resolveIcon, never read primitives.Icon* directly');
const iconPairs = [...code.matchAll(/resolveIcon\("([A-Za-z0-9]+)",\s*"([A-Za-z0-9]+)"\)/g)];
assert.equal(iconPairs.length, 12, 'the icon resolver table must cover all 12 renamed glyphs');
for (const [, current, legacy] of iconPairs) {
  assert.ok(current.endsWith('Regular'), 'current icon name must be the 0.1.7 *Regular glyph: ' + current);
  assert.ok(/(?:Medium|16|14|12)$/.test(legacy), 'legacy icon name must keep its size suffix: ' + legacy);
}
for (const line of code.replace(/resolveIcon\("[A-Za-z0-9]+",\s*"[A-Za-z0-9]+"\)/g, '').split('\n')) {
  if (line.trimStart().startsWith('//')) continue;
  assert.equal(/Icon[A-Za-z]+(?:Outline|Fill)?1[0-9]\b/.exec(line), null, 'stale size-suffixed icon identifier in code: ' + line.trim());
}

console.log('client.js static self-check OK');
console.log('  id =', loaded.id);
console.log('  inject =', JSON.stringify(mod.inject));
console.log('  requires =', JSON.stringify([...required]));
