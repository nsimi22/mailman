import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, prepareRequest, toCurl, variablesToMap } from '../src/send.js';

test('interpolate replaces known variables and leaves unknown ones', () => {
  assert.equal(interpolate('{{base}}/users/{{ id }}?x={{missing}}', { base: 'http://a', id: '7' }), 'http://a/users/7?x={{missing}}');
});

test('variablesToMap respects enabled flag', () => {
  assert.deepEqual(variablesToMap([{ key: 'a', value: '1' }, { key: 'b', value: '2', enabled: false }]), { a: '1' });
});

test('prepareRequest builds url, query, auth and json body', () => {
  const p = prepareRequest({
    method: 'post',
    url: '{{base}}/items',
    params: [{ key: 'page', value: '{{page}}' }, { key: 'off', value: 'x', enabled: false }],
    headers: [{ key: 'X-Team', value: 'mailman' }],
    auth: { type: 'bearer', token: '{{token}}' },
    body: { mode: 'json', content: '{"name":"{{name}}"}' },
  }, { base: 'https://api.example.com', page: '2', token: 'T', name: 'n' });
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'https://api.example.com/items?page=2');
  assert.deepEqual(p.headers, [['X-Team', 'mailman'], ['Authorization', 'Bearer T'], ['Content-Type', 'application/json']]);
  assert.equal(p.body, '{"name":"n"}');
  assert.deepEqual(p.warnings, []);
});

test('prepareRequest handles basic auth, api key in query, and missing scheme', () => {
  const p = prepareRequest({ method: 'GET', url: 'example.com/a?x=1', auth: { type: 'apikey', key: 'k', value: 'v', in: 'query' } });
  assert.equal(p.url, 'http://example.com/a?x=1&k=v');
  const b = prepareRequest({ method: 'GET', url: 'http://x', auth: { type: 'basic', username: 'u', password: 'p' } });
  assert.deepEqual(b.headers, [['Authorization', `Basic ${Buffer.from('u:p').toString('base64')}`]]);
});

test('prepareRequest warns about unresolved variables and ignores GET bodies', () => {
  const p = prepareRequest({ method: 'GET', url: 'http://x/{{nope}}', body: { mode: 'json', content: '{}' } }, {});
  assert.ok(p.warnings.some((w) => w.includes('{{nope}}')));
  assert.ok(p.warnings.some((w) => w.includes('Body ignored')));
  assert.equal(p.body, undefined);
});

test('toCurl quotes safely', () => {
  const p = prepareRequest({ method: 'POST', url: "http://x/it's", headers: [{ key: 'A', value: 'b' }], body: { mode: 'raw', content: 'hi' } });
  const c = toCurl(p);
  assert.ok(c.startsWith("curl -X POST 'http://x/it'\\''s'"));
  assert.ok(c.includes("-H 'A: b'"));
  assert.ok(c.includes("--data-raw 'hi'"));
});
