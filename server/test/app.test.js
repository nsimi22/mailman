import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let store, server, base, echo, echoBase;

before(async () => {
  store = openDatabase(':memory:');
  server = http.createServer(createApp(store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  echo = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Echo', 'yes');
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: data }));
    });
  });
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  echoBase = `http://127.0.0.1:${echo.address().port}`;
});
after(() => { server.close(); echo.close(); store.close(); });

const api = async (method, path, body) => {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

test('collection / folder / request CRUD and tree listing', async () => {
  const c = await api('POST', '/collections', { name: 'Team' });
  assert.equal(c.status, 201);
  const f = await api('POST', '/folders', { collectionId: c.json.id, name: 'Users' });
  assert.equal(f.status, 201);
  const r = await api('POST', '/requests', { collectionId: c.json.id, folderId: f.json.id, name: 'Get me', method: 'get', url: '{{base}}/me' });
  assert.equal(r.status, 201);
  assert.equal(r.json.method, 'GET');

  const tree = await api('GET', '/collections');
  assert.equal(tree.json.length, 1);
  assert.equal(tree.json[0].folders.length, 1);
  assert.equal(tree.json[0].requests.length, 1);

  const upd = await api('PATCH', `/requests/${r.json.id}`, { name: 'Get me v2', headers: [{ key: 'A', value: '1' }] });
  assert.equal(upd.json.name, 'Get me v2');
  assert.deepEqual(upd.json.headers, [{ key: 'A', value: '1', enabled: true }]);

  const badReq = await api('POST', '/requests', { collectionId: 'nope', name: 'x' });
  assert.equal(badReq.status, 400);

  assert.equal((await api('DELETE', `/folders/${f.json.id}`)).status, 204);
  // cascade removed the request
  assert.equal((await api('GET', `/requests/${r.json.id}`)).status, 404);
  assert.equal((await api('DELETE', `/collections/${c.json.id}`)).status, 204);
});

test('send proxies a request with environment variables and records history', async () => {
  const env = await api('POST', '/environments', { name: 'Local', variables: [{ key: 'base', value: echoBase }, { key: 'who', value: 'team' }] });
  const sent = await api('POST', '/send', {
    environmentId: env.json.id,
    request: {
      method: 'POST',
      url: '{{base}}/hello',
      params: [{ key: 'q', value: '{{who}}' }],
      headers: [{ key: 'X-Custom', value: 'abc' }],
      auth: { type: 'bearer', token: 'tok' },
      body: { mode: 'json', content: '{"hi":"{{who}}"}' },
    },
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.ok, true);
  assert.equal(sent.json.status, 200);
  const echoed = JSON.parse(sent.json.body);
  assert.equal(echoed.method, 'POST');
  assert.equal(echoed.url, '/hello?q=team');
  assert.equal(echoed.headers['x-custom'], 'abc');
  assert.equal(echoed.headers.authorization, 'Bearer tok');
  assert.equal(echoed.headers['content-type'], 'application/json');
  assert.equal(echoed.body, '{"hi":"team"}');
  assert.ok(sent.json.headers.some(([k, v]) => k === 'x-echo' && v === 'yes'));
  assert.equal(sent.json.sent.url, `${echoBase}/hello?q=team`);

  const hist = await api('GET', '/history');
  assert.equal(hist.json.length, 1);
  assert.equal(hist.json[0].request.url, '{{base}}/hello');
  assert.equal(hist.json[0].response.status, 200);
  assert.equal((await api('DELETE', '/history')).status, 204);
  assert.equal((await api('GET', '/history')).json.length, 0);
});

test('send reports connection errors instead of crashing', async () => {
  // grab a free port, then release it so nothing is listening there
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const deadPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  const sent = await api('POST', '/send', { request: { method: 'GET', url: `http://127.0.0.1:${deadPort}` }, saveHistory: false });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.ok, false);
  assert.match(sent.json.error, /ECONNREFUSED/);
});

test('import and export endpoints', async () => {
  const imported = await api('POST', '/import', { info: { name: 'Imp' }, item: [{ name: 'A', request: 'http://a' }] });
  assert.equal(imported.status, 201);
  assert.equal(imported.json.type, 'collection');
  const exported = await api('GET', `/collections/${imported.json.collection.id}/export`);
  assert.equal(exported.json.item[0].name, 'A');
  const envImp = await api('POST', '/import', { name: 'E', values: [{ key: 'a', value: '1' }] });
  assert.equal(envImp.json.type, 'environment');
  const invalid = await api('POST', '/import', { nothing: true });
  assert.equal(invalid.status, 400);
});

test('curl endpoint', async () => {
  const r = await api('POST', '/curl', { request: { method: 'GET', url: 'http://x/y', headers: [{ key: 'A', value: 'b' }] } });
  assert.equal(r.json.curl, "curl -X GET 'http://x/y' \\\n  -H 'A: b'");
});

test('password gate', async () => {
  const s = openDatabase(':memory:');
  const srv = http.createServer(createApp(s, { password: 'secret' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await fetch(b + '/api/health')).status, 401);
  const ok = await fetch(b + '/api/health', { headers: { Authorization: 'Basic ' + Buffer.from('anyone:secret').toString('base64') } });
  assert.equal(ok.status, 200);
  srv.close(); s.close();
});
