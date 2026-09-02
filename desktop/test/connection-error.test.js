/**
 * describeFetchError turns opaque connection failures into actionable text.
 *
 * The errors here come from REAL failed fetches against real sockets, not from
 * hand-built {cause:{code}} objects — the whole point of the function is to match the
 * shapes Node/undici actually throws, and a fixture we invented ourselves could agree
 * with the code while both disagree with reality.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describeFetchError } from '../src/connection-error.js';

/** Runs `fetch(url)`, expects it to reject, and returns the description. */
async function describeFailedFetch(url, init) {
  try {
    await fetch(url, init);
    assert.fail(`expected fetch(${url}) to reject`);
  } catch (err) {
    return describeFetchError(err, url);
  }
}

/** A port with nothing behind it: bind, read the port, close. */
async function closedPort() {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('nothing listening -> names the address and how to start the server', async () => {
  const port = await closedPort();
  const msg = await describeFailedFetch(`http://127.0.0.1:${port}/api/health`);
  assert.match(msg, /Nothing is listening on 127\.0\.0\.1:/);
  assert.match(msg, /docker compose up -d/);
  assert.doesNotMatch(msg, /fetch failed/);
});

test('https against a plain-http server -> tells the user to use http://', async () => {
  // This is the exact mistake the Workspace dialog's old placeholder invited.
  const server = createServer((_req, res) => res.end('{"ok":true}'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const msg = await describeFailedFetch(`https://127.0.0.1:${port}/api/health`);
    assert.match(msg, /not an https server|without TLS/);
    assert.match(msg, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
    assert.doesNotMatch(msg, /fetch failed/);
  } finally {
    server.close();
  }
});

test('unresolvable host -> points at spelling and VPN', async () => {
  const msg = await describeFailedFetch('http://mailman.invalid.nonexistent-tld-for-tests./api/health');
  assert.match(msg, /Cannot resolve the host/);
  assert.match(msg, /VPN/);
});

test('timeout -> says so and does not claim the host is wrong', async () => {
  // A socket that accepts and then never answers.
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const msg = await describeFailedFetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(150),
    });
    assert.match(msg, /No answer from 127\.0\.0\.1:/);
    assert.match(msg, /firewall|unreachable/);
  } finally {
    server.close();
  }
});

test('a bare "fetch failed" is never surfaced on its own', () => {
  const bare = Object.assign(new TypeError('fetch failed'), { cause: undefined });
  const msg = describeFetchError(bare, 'http://example.test:4000');
  assert.match(msg, /Could not reach example\.test:4000/);
  assert.notEqual(msg, 'fetch failed');
});

test('an unparseable URL still yields a message rather than throwing', () => {
  const msg = describeFetchError(new TypeError('fetch failed'), 'not a url');
  assert.match(msg, /not a url/);
});
