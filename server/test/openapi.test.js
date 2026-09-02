import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { requestsFromSpec, applySpecToCollection, exampleFromSchema, isOpenApiDocument, parseSpecText } from '../src/openapi.js';

const spec = (extra = {}) => ({
  openapi: '3.0.3',
  info: { title: 'Nexus', version: '1.0' },
  servers: [{ url: 'https://nexus.example.com/v1' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Site: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', example: 'HQ' }, kw: { type: 'number' }, active: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } } },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    '/sites': {
      get: { tags: ['Sites'], summary: 'List sites', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }, { name: 'q', in: 'query', required: true, schema: { type: 'string' } }] },
      post: { tags: ['Sites'], summary: 'Create site', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } } } },
    },
    '/sites/{siteId}': {
      parameters: [{ name: 'siteId', in: 'path', required: true, schema: { type: 'string' } }],
      delete: { tags: ['Sites'], operationId: 'deleteSite', security: [] },
    },
    '/health': { get: { summary: 'Health' } },
    ...extra,
  },
});

test('requestsFromSpec maps operations to requests', () => {
  const reqs = requestsFromSpec(spec());
  assert.equal(reqs.length, 4);
  const list = reqs.find((r) => r.sourceKey === 'GET /sites');
  assert.equal(list.url, '{{baseUrl}}/sites');
  assert.equal(list.folder, 'Sites');
  assert.deepEqual(list.params, [{ key: 'limit', value: '20', enabled: false }, { key: 'q', value: 'string', enabled: true }]);
  assert.deepEqual(list.auth, { type: 'bearer', token: '{{token}}' });
  const create = reqs.find((r) => r.sourceKey === 'POST /sites');
  assert.equal(create.body.mode, 'json');
  assert.deepEqual(JSON.parse(create.body.content), { id: '00000000-0000-0000-0000-000000000000', name: 'HQ', kw: 0, active: true, tags: ['string'] });
  const del = reqs.find((r) => r.sourceKey === 'DELETE /sites/{siteId}');
  assert.equal(del.url, '{{baseUrl}}/sites/{{siteId}}');
  assert.equal(del.name, 'deleteSite');
  assert.deepEqual(del.auth, { type: 'none' });
  const health = reqs.find((r) => r.sourceKey === 'GET /health');
  assert.equal(health.folder, 'health');
});

test('applySpecToCollection upserts, removes stale, keeps ids', () => {
  const store = openDatabase(':memory:');
  const c = store.createCollection({ name: 'Nexus', sourceUrl: 'http://x/openapi.json' });
  assert.equal(applySpecToCollection(store, c.id, spec()), 4);
  const before = store.listRequests(c.id);
  assert.equal(before.length, 4);
  assert.equal(store.listFolders(c.id).length, 2);
  const listId = before.find((r) => r.sourceKey === 'GET /sites').id;

  // endpoint added, one removed, one renamed
  const next = spec({ '/alerts': { get: { tags: ['Alerts'], summary: 'List alerts' } } });
  delete next.paths['/health'];
  next.paths['/sites'].get.summary = 'List all sites';
  assert.equal(applySpecToCollection(store, c.id, next), 4);
  const after = store.listRequests(c.id);
  assert.equal(after.length, 4);
  assert.ok(after.some((r) => r.sourceKey === 'GET /alerts'));
  assert.ok(!after.some((r) => r.sourceKey === 'GET /health'));
  assert.equal(after.find((r) => r.sourceKey === 'GET /sites').id, listId, 'existing request keeps its id');
  assert.equal(after.find((r) => r.sourceKey === 'GET /sites').name, 'List all sites');
  assert.deepEqual(store.listFolders(c.id).map((f) => f.name).sort(), ['Alerts', 'Sites'], 'empty tag folder removed');
  assert.ok(store.getCollection(c.id).sourceSyncedAt);
  store.close();
});

test('swagger 2 body and formData parameters', () => {
  const reqs = requestsFromSpec({
    swagger: '2.0', info: { title: 'Old' }, host: 'old.example.com', basePath: '/api',
    securityDefinitions: { key: { type: 'apiKey', name: 'X-Key', in: 'header' } }, security: [{ key: [] }],
    paths: {
      '/things': { post: { parameters: [{ name: 'body', in: 'body', schema: { type: 'object', properties: { n: { type: 'integer' } } } }] } },
      '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ name: 'file', in: 'formData', type: 'string', required: true }] } },
    },
  });
  assert.deepEqual(reqs[0].body, { mode: 'json', content: '{\n  "n": 0\n}' });
  assert.deepEqual(reqs[0].auth, { type: 'apikey', key: 'X-Key', value: '{{apiKey}}', in: 'header' });
  assert.equal(reqs[1].body.mode, 'form');
  assert.deepEqual(reqs[1].body.fields, [{ key: 'file', value: 'string', enabled: true }]);
});

test('exampleFromSchema handles refs, enums, allOf and depth', () => {
  const s = { components: { schemas: { A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } }, B: { type: 'string', enum: ['x', 'y'] } } } };
  assert.deepEqual(exampleFromSchema(s, { $ref: '#/components/schemas/A' }), { b: 'x' });
  assert.deepEqual(exampleFromSchema(s, { allOf: [{ type: 'object', properties: { a: { type: 'integer' } } }, { type: 'object', properties: { c: { type: 'boolean' } } }] }), { a: 0, c: true });
  const loop = { components: { schemas: { N: { type: 'object', properties: { next: { $ref: '#/components/schemas/N' } } } } } };
  assert.ok(exampleFromSchema(loop, { $ref: '#/components/schemas/N' }));
});

test('parseSpecText accepts JSON and YAML', async () => {
  assert.equal((await parseSpecText('{"openapi":"3.0.0","paths":{}}')).openapi, '3.0.0');
  const y = await parseSpecText('openapi: 3.0.0\ninfo:\n  title: Y\npaths:\n  /a:\n    get:\n      summary: A\n');
  assert.ok(isOpenApiDocument(y));
  assert.equal(requestsFromSpec(y)[0].name, 'A');
});

test('from-openapi endpoint links a collection and sync picks up new endpoints', async () => {
  let current = spec();
  const specServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(current)); });
  await new Promise((r) => specServer.listen(0, '127.0.0.1', r));
  const specUrl = `http://127.0.0.1:${specServer.address().port}/openapi.json`;
  const store = openDatabase(':memory:');
  const server = http.createServer(createApp(store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const linked = await call('POST', '/collections/from-openapi', { url: specUrl });
  assert.equal(linked.status, 201);
  assert.equal(linked.json.name, 'Nexus');
  assert.equal(linked.json.sourceUrl, specUrl);
  assert.equal(linked.json.requests.length, 4);

  current = spec({ '/alerts': { get: { tags: ['Alerts'], summary: 'List alerts' } } });
  const synced = await call('POST', `/collections/${linked.json.id}/sync`);
  assert.equal(synced.status, 200);
  assert.equal(synced.json.synced, 5);
  const tree = await call('GET', '/collections');
  assert.equal(tree.json[0].requests.length, 5);

  // unlink keeps the requests
  const unlinked = await call('PATCH', `/collections/${linked.json.id}`, { sourceUrl: null });
  assert.equal(unlinked.json.sourceUrl, null);
  assert.equal((await call('POST', `/collections/${linked.json.id}/sync`)).status, 400);

  // bad URLs are rejected cleanly
  assert.equal((await call('POST', '/collections/from-openapi', { url: 'ftp://nope' })).status, 400);
  assert.equal((await call('POST', '/collections/from-openapi', { url: `${base}/health` })).status, 400);

  // importing an OpenAPI document directly also works
  const imported = await call('POST', '/import', spec());
  assert.equal(imported.json.type, 'collection');

  server.close(); specServer.close(); store.close();
});
