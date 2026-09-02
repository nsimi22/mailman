import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { importCollection, exportCollection, parseEnvironment } from '../src/postman.js';

const sample = {
  info: { name: 'Pets API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Pets',
      item: [
        {
          name: 'List pets',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }],
            url: { raw: '{{base}}/pets?limit=10', host: ['{{base}}'], path: ['pets'], query: [{ key: 'limit', value: '10' }] },
            auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
          },
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            url: '{{base}}/pets',
            body: { mode: 'raw', raw: '{"name":"Rex"}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    },
    { name: 'Ping', request: 'https://example.com/ping' },
  ],
};

test('import then export round-trips a Postman collection', () => {
  const store = openDatabase(':memory:');
  const col = importCollection(store, sample);
  assert.equal(col.name, 'Pets API');
  const folders = store.listFolders(col.id);
  const requests = store.listRequests(col.id);
  assert.equal(folders.length, 1);
  assert.equal(requests.length, 3);
  const list = requests.find((r) => r.name === 'List pets');
  assert.equal(list.url, '{{base}}/pets');
  assert.deepEqual(list.params, [{ key: 'limit', value: '10', enabled: true }]);
  assert.deepEqual(list.auth, { type: 'bearer', token: '{{token}}' });
  const create = requests.find((r) => r.name === 'Create pet');
  assert.deepEqual(create.body, { mode: 'json', content: '{"name":"Rex"}' });
  const ping = requests.find((r) => r.name === 'Ping');
  assert.equal(ping.url, 'https://example.com/ping');
  assert.equal(ping.folderId, null);

  const out = exportCollection(store, col.id);
  assert.equal(out.info.name, 'Pets API');
  assert.equal(out.item.length, 2);
  const folder = out.item.find((i) => i.name === 'Pets');
  assert.equal(folder.item.length, 2);
  const exported = folder.item.find((i) => i.name === 'List pets');
  assert.equal(exported.request.url.raw, '{{base}}/pets?limit=10');
  assert.equal(exported.request.auth.type, 'bearer');

  // re-import the export and check it matches
  const again = importCollection(store, out);
  assert.equal(store.listRequests(again.id).length, 3);
  store.close();
});

test('parseEnvironment reads Postman environment exports', () => {
  const env = parseEnvironment({ name: 'Dev', values: [{ key: 'base', value: 'http://localhost', enabled: true, type: 'default' }, { key: 'tok', value: 's', enabled: false, type: 'secret' }] });
  assert.deepEqual(env, { name: 'Dev', variables: [
    { key: 'base', value: 'http://localhost', enabled: true, secret: false },
    { key: 'tok', value: 's', enabled: false, secret: true },
  ] });
});

test('rejects things that are not collections', () => {
  const store = openDatabase(':memory:');
  assert.throws(() => importCollection(store, { hello: 'world' }), /Not a Postman collection/);
  store.close();
});
