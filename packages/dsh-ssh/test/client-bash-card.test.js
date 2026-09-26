// @dsh-ssh/dsh-ssh — the SSH bash tool card model under DSH 0.1.7.
// Host presentation (block.callView/resultView) no longer reaches the client, so the
// card is derived from the raw call args plus the rendered result text: command and
// description from argsRaw, output and status recovered with the official
// parseExitStatus inverse ([exit code: N] / [killed by signal: X] as the final line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CLIENT_PATH = new URL('../client.js', import.meta.url);
const SOURCE = readFileSync(CLIENT_PATH, 'utf8');

/** Minimal react face plus a primitive-element record (props of created atoms). */
function createHarness() {
  const primitives = [];
  const names = [
    'Button', 'Input', 'Menu', 'Modal', 'Pill', 'StateDot', 'TerminalBlock',
    'IconPlusOutlineRegular', 'IconEditOutlineRegular', 'IconTrashOutlineRegular', 'IconCheckOutlineRegular',
    'IconWarningOutlineRegular', 'IconRefreshOutlineRegular', 'IconCloseOutlineRegular', 'IconLoadingOutlineRegular',
    'IconFolderCloseRegular', 'IconChevronDownOutlineRegular', 'IconApiOutlineRegular', 'IconInspectOutlineRegular',
  ];
  const stub = {};
  const stubNames = new Map();
  for (const name of names) {
    stub[name] = (props) => ({ type: name, props: props ?? {} });
    stubNames.set(stub[name], name);
  }
  const element = (type, props, ...children) => {
    const next = Object.assign({}, props);
    if (children.length === 1) next.children = children[0];
    else if (children.length > 1) next.children = children;
    const primitive = stubNames.get(type);
    if (primitive !== undefined) primitives.push({ name: primitive, props: next });
    return { type, props: next };
  };
  const react = {
    createElement: element,
    // The row only builds its card while expanded, so boolean state starts open here.
    useState: (initial) => [typeof initial === 'boolean' ? true : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    Fragment: 'Fragment',
    memo: (component) => component,
    createContext: () => ({ Provider: 'Fragment', Consumer: 'Fragment' }),
    useContext: () => undefined,
  };
  const requireStub = (id) => {
    if (id === 'react') return react;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return stub;
    throw new Error('client.js required an unexpected module: ' + id);
  };

  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ style: {}, dataset: {}, appendChild: () => {}, setAttribute: () => {}, select: () => {} }),
    execCommand: () => true,
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
  };
  let loaded = null;
  globalThis.window.__ModuleLoader__ = { load: (options) => { loaded = options; } };
  (0, eval)(SOURCE);
  assert.ok(loaded, 'window.__ModuleLoader__.load was not called');
  const plugin = loaded.factory(requireStub);

  const registered = [];
  const ctx = {
    get: () => undefined,
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
  return { registered, primitives };
}

/** Render the registered bash toolview with one block and return created primitives. */
function renderBashRow(block) {
  const harness = createHarness();
  const row = harness.registered.find((entry) => entry.options.name === 'tool.call.toolview');
  assert.ok(row, 'the plugin must register the bash toolview');
  assert.equal(row.options.key, 'bash');
  const t = (key) => key;
  row.Component({
    toolName: 'bash',
    block,
    sessionId: 'session-1',
    useSessions: () => undefined,
    t,
  });
  return harness.primitives.filter((entry) => entry.name === 'TerminalBlock');
}

const ARGS = JSON.stringify({ command: 'echo hi', description: 'say hi' });

test('a running bash call derives its card from the raw args', () => {
  const cards = renderBashRow({ callId: 'c1', name: 'bash', argsRaw: ARGS });
  assert.equal(cards.length, 1, 'the running row must carry one terminal card');
  assert.equal(cards[0].props.command, 'echo hi');
  assert.equal(cards[0].props.running, true);
  assert.equal(cards[0].props.exitCode, undefined);
  assert.equal(cards[0].props.output, undefined);
});

test('a settled bash call recovers output and exit status from the rendered text', () => {
  const cards = renderBashRow({
    kind: 'result',
    name: 'bash',
    call: { argsRaw: ARGS },
    isError: false,
    content: [{ type: 'text', text: 'hi there\nsecond line\n[exit code: 3]' }],
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].props.command, 'echo hi');
  assert.equal(cards[0].props.running, false);
  assert.equal(cards[0].props.exitCode, 3);
  assert.equal(cards[0].props.output, 'hi there\nsecond line', 'the status marker is consumed by the pill');
  // TerminalBlock requires every label; the no-exit-code label is part of the contract.
  assert.equal(cards[0].props.labels.noExitCode, 'terminal.noExitCode');
});

test('a signal-terminated bash call reports the signal instead of an exit code', () => {
  const cards = renderBashRow({
    kind: 'result',
    name: 'bash',
    call: { argsRaw: ARGS },
    isError: false,
    content: [{ type: 'text', text: 'partial\n[killed by signal: SIGKILL]' }],
  });
  assert.equal(cards[0].props.signal, 'SIGKILL');
  assert.equal(cards[0].props.exitCode, undefined);
  assert.equal(cards[0].props.output, 'partial');
});

test('a clean exit reports exit code 0 with the marker-free body', () => {
  const cards = renderBashRow({
    kind: 'result',
    name: 'bash',
    call: { argsRaw: ARGS },
    isError: false,
    content: [{ type: 'text', text: 'all good' }],
  });
  assert.equal(cards[0].props.exitCode, 0);
  assert.equal(cards[0].props.output, 'all good');
});

test('a background call keeps the generic row (no terminal card)', () => {
  const args = JSON.stringify({ command: 'sleep 30', description: 'wait', run_in_background: true });
  const cards = renderBashRow({ kind: 'result', name: 'bash', call: { argsRaw: args }, isError: false, content: [{ type: 'text', text: '{"jobId":"bash-1"}' }] });
  assert.deepEqual(cards, [], 'a background call reports a job id, not a process status');
});

test('an errored bash call keeps the generic error row', () => {
  const cards = renderBashRow({
    kind: 'result',
    name: 'bash',
    call: { argsRaw: ARGS },
    isError: true,
    error: { name: 'ToolError', code: 'SSH_FAILED' },
    content: [{ type: 'text', text: 'connect failed' }],
  });
  assert.deepEqual(cards, []);
});

test('a workdir argument resolves against the session cwd', () => {
  const args = JSON.stringify({ command: 'pwd', workdir: 'sub' });
  const cards = renderBashRow({ callId: 'c2', name: 'bash', argsRaw: args });
  assert.equal(cards[0].props.cwd, 'sub', 'without a session cwd the view workdir passes through');
  const harness = createHarness();
  const row = harness.registered.find((entry) => entry.options.name === 'tool.call.toolview');
  row.Component({ toolName: 'bash', block: { callId: 'c2', name: 'bash', argsRaw: args }, sessionId: 's', useSessions: () => '/data/work', t: (key) => key });
  const withCwd = harness.primitives.filter((entry) => entry.name === 'TerminalBlock');
  assert.equal(withCwd[0].props.cwd, '/data/work/sub');
});
