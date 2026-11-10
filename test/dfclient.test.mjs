import process from 'node:process';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RpcError } from 'dfhack-remote-node';

const DEADLINE_MS = 50;
process.env.DFHACK_MCP_TIMEOUT_MS = String(DEADLINE_MS);
const { runLua, runScript, runDfhackCommand, TimeoutError, NotConnectedError, _setClientFactory } =
  await import('../src/dfclient.ts');

const never = () => new Promise(() => {});
const PROBE = 'addScriptPath) and "yes"';

let clients;
let sent;

const SENTINEL_PROBE = "findScript('mcp_gameState')";

function install({
  onCommand = never,
  onSnippet = async () => '',
  onConnect = async () => {},
  onSentinel = async () => '/queries/mcp_gameState.lua',
} = {}) {
  clients = [];
  sent = [];
  _setClientFactory(() => {
    const c = {
      connected: false,
      closed: false,
      async connect() {
        await onConnect();
        this.connected = true;
        return this;
      },
      close() {
        this.connected = false;
        this.closed = true;
      },
      runLuaSnippet(snippet) {
        if (snippet.includes(PROBE)) return Promise.resolve('yes');
        if (snippet.startsWith('dfhack.internal.addScriptPath')) return Promise.resolve('');
        if (snippet.includes(SENTINEL_PROBE)) return onSentinel();
        sent.push(['lua', snippet]);
        return onSnippet(snippet);
      },
      runCommand(command, args) {
        sent.push([command, args]);
        return onCommand(command, args);
      },
    };
    clients.push(c);
    return c;
  });
}

beforeEach(() => install());

async function assertTimesOutOnce(call) {
  const started = Date.now();
  await assert.rejects(call(), TimeoutError);
  assert.ok(Date.now() - started < DEADLINE_MS * 20, 'rejected near the deadline');
  assert.equal(sent.length, 1, 'the timed-out call was sent once, never retried');
  assert.equal(clients.length, 1, 'no reconnect attempt after the timeout');
  assert.equal(clients[0].closed, true, 'the connection was reset');
}

test('a query script that never answers times out without a retry', async () => {
  await assertTimesOutOnce(() => runScript('workOrder', ['apply', 'x']));
});

test('a DFHack command that never answers times out without a retry', async () => {
  await assertTimesOutOnce(() => runDfhackCommand('seedwatch', ['all', '0']));
});

test('a Lua snippet that never answers times out without a retry', async () => {
  install({ onSnippet: never });
  await assertTimesOutOnce(() => runLua('print(1)'));
});

test('the call after a timeout reconnects on a fresh client', async () => {
  let hang = true;
  install({ onCommand: () => (hang ? never() : Promise.resolve('{"ok":true}')) });
  await assert.rejects(runScript('fortStatus'), TimeoutError);
  hang = false;
  assert.equal(await runScript('fortStatus'), '{"ok":true}');
  assert.equal(clients.length, 2);
  assert.equal(clients[1].closed, false);
});

test('a handshake that never completes times out and closes the half-open client', async () => {
  install({ onConnect: never });
  await assert.rejects(runScript('fortStatus'), TimeoutError);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].closed, true);
  assert.equal(sent.length, 0);
});

test('an RpcError is rethrown without a retry', async () => {
  install({ onCommand: () => Promise.reject(new RpcError('RPC call failed (1)', 1)) });
  await assert.rejects(runScript('workOrder', ['apply']), RpcError);
  assert.equal(sent.length, 1);
});

test('a connection-level failure is retried once, then reported as NotConnectedError', async () => {
  install({ onCommand: () => Promise.reject(new Error('connection closed')) });
  await assert.rejects(runScript('fortStatus'), NotConnectedError);
  assert.equal(sent.length, 2);
  assert.equal(clients.length, 2);
});

const unrecognized = (name) =>
  new RpcError(
    'RPC call failed (-1)',
    -1,
    `mcp_${name} is not a recognized command.
`
  );

const commandsSent = (name) => sent.filter(([c]) => c === name).length;

test('an unrecognized DFHack command is reported as-is', async () => {
  install({ onCommand: () => Promise.reject(unrecognized('seedwatch')) });
  await assert.rejects(runDfhackCommand('seedwatch', ['all']), RpcError);
  assert.equal(commandsSent('seedwatch'), 1, 'sent once, not retried');
});

test('a query path DFHack will not accept fails the connection, naming the path', async () => {
  install({ onSentinel: async () => 'nil' });
  await assert.rejects(runScript('fortStatus'), (err) => {
    assert.match(err.message, /did not accept the query script path/);
    assert.match(err.message, /DFHACK_MCP_QUERY_DIR/);
    assert.match(err.message, /MSYS_NO_PATHCONV/);
    return true;
  });
  assert.equal(sent.length, 0, 'no command is attempted against a path DFHack cannot read');
});

test('an empty answer from the path check is treated as failure, not success', async () => {
  install({ onSentinel: async () => '' });
  await assert.rejects(runScript('fortStatus'), /did not accept the query script path/);
});

test('concurrent first calls share one connection', async () => {
  install({ onCommand: async (cmd) => `{"cmd":"${cmd}"}` });
  await Promise.all([runScript('a'), runScript('b'), runScript('c')]);
  assert.equal(clients.length, 1);
});
