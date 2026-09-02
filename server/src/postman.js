/**
 * Import / export of the Postman Collection v2.1 format (v2.0 is close enough to be handled too)
 * and the Postman environment export format.
 */

const kv = (list, valueKey = 'value') =>
  (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === 'object' && x.key != null)
    .map((x) => ({ key: String(x.key), value: String(x[valueKey] ?? ''), enabled: x.disabled !== true, ...(x.description ? { description: String(typeof x.description === 'object' ? x.description.content ?? '' : x.description) } : {}) }));

function authFromPostman(auth) {
  if (!auth || typeof auth !== 'object') return { type: 'none' };
  const pick = (arr, key) => {
    if (Array.isArray(arr)) return arr.find((x) => x.key === key)?.value ?? '';
    if (arr && typeof arr === 'object') return arr[key] ?? '';
    return '';
  };
  switch (auth.type) {
    case 'bearer': return { type: 'bearer', token: String(pick(auth.bearer, 'token')) };
    case 'basic': return { type: 'basic', username: String(pick(auth.basic, 'username')), password: String(pick(auth.basic, 'password')) };
    case 'apikey': return {
      type: 'apikey',
      key: String(pick(auth.apikey, 'key')),
      value: String(pick(auth.apikey, 'value')),
      in: pick(auth.apikey, 'in') === 'query' ? 'query' : 'header',
    };
    default: return { type: 'none' };
  }
}

function bodyFromPostman(body) {
  if (!body || typeof body !== 'object') return { mode: 'none' };
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language;
      const raw = String(body.raw ?? '');
      if (lang === 'json' || (!lang && looksLikeJson(raw))) return { mode: 'json', content: raw };
      const contentType = { xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' }[lang] || 'text/plain';
      return { mode: 'raw', content: raw, contentType };
    }
    case 'urlencoded': return { mode: 'urlencoded', fields: kv(body.urlencoded) };
    case 'formdata': return { mode: 'form', fields: kv(body.formdata) };
    default: return { mode: 'none' };
  }
}

function looksLikeJson(s) {
  const t = s.trim();
  if (!t) return false;
  try { JSON.parse(t); return true; } catch { return /^[\[{]/.test(t); }
}

function urlFromPostman(url) {
  if (typeof url === 'string') return { url, params: [] };
  if (!url || typeof url !== 'object') return { url: '', params: [] };
  let raw = url.raw;
  if (!raw) {
    const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? '';
    const path = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
    raw = `${url.protocol ? url.protocol + '://' : ''}${host}${url.port ? ':' + url.port : ''}${path ? '/' + path : ''}`;
  }
  // Postman keeps the query in `raw` too; strip it so params are not sent twice.
  const params = kv(url.query);
  const qIdx = raw.indexOf('?');
  if (params.length && qIdx >= 0) raw = raw.slice(0, qIdx);
  return { url: raw, params };
}

function requestFromPostman(item) {
  const r = typeof item.request === 'string' ? { method: 'GET', url: item.request } : item.request ?? {};
  const { url, params } = urlFromPostman(r.url);
  return {
    name: String(item.name ?? 'Untitled request'),
    method: String(r.method ?? 'GET').toUpperCase(),
    url,
    params,
    headers: kv(r.header),
    body: bodyFromPostman(r.body),
    auth: authFromPostman(r.auth),
    description: String(typeof r.description === 'object' ? r.description?.content ?? '' : r.description ?? ''),
  };
}

/** Parse a Postman collection JSON into a plain tree. */
export function parseCollection(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.item)) {
    throw new Error('Not a Postman collection: expected an object with an "item" array.');
  }
  const walk = (items) => items.map((it) => {
    if (Array.isArray(it.item)) return { type: 'folder', name: String(it.name ?? 'Folder'), children: walk(it.item) };
    return { type: 'request', ...requestFromPostman(it) };
  });
  return {
    name: String(json.info?.name ?? json.name ?? 'Imported collection'),
    description: String(typeof json.info?.description === 'object' ? json.info.description?.content ?? '' : json.info?.description ?? ''),
    items: walk(json.item),
  };
}

/** Insert a parsed tree into the store. Returns the created collection. */
export function importCollection(store, json) {
  const tree = parseCollection(json);
  return store.transaction(() => {
    const collection = store.createCollection({ name: tree.name, description: tree.description });
    const insert = (items, folderId) => {
      for (const it of items) {
        if (it.type === 'folder') {
          const f = store.createFolder({ collectionId: collection.id, parentId: folderId, name: it.name });
          insert(it.children, f.id);
        } else {
          const { type, ...req } = it;
          store.createRequest({ ...req, collectionId: collection.id, folderId });
        }
      }
    };
    insert(tree.items, null);
    return collection;
  });
}

/** Parse a Postman environment export ({ name, values: [...] }). */
export function parseEnvironment(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.values)) {
    throw new Error('Not a Postman environment: expected an object with a "values" array.');
  }
  return {
    name: String(json.name ?? 'Imported environment'),
    variables: json.values
      .filter((v) => v && typeof v === 'object' && v.key != null)
      .map((v) => ({ key: String(v.key), value: String(v.value ?? ''), enabled: v.enabled !== false, secret: v.type === 'secret' })),
  };
}

export function isPostmanEnvironment(json) {
  return !!json && typeof json === 'object' && Array.isArray(json.values) && !Array.isArray(json.item);
}

// ---- export ----------------------------------------------------------------

const kvOut = (list) => list.map((x) => ({ key: x.key, value: x.value, ...(x.enabled ? {} : { disabled: true }), ...(x.description ? { description: x.description } : {}) }));

function authToPostman(auth) {
  switch (auth?.type) {
    case 'bearer': return { type: 'bearer', bearer: [{ key: 'token', value: auth.token, type: 'string' }] };
    case 'basic': return { type: 'basic', basic: [{ key: 'username', value: auth.username, type: 'string' }, { key: 'password', value: auth.password, type: 'string' }] };
    case 'apikey': return { type: 'apikey', apikey: [{ key: 'key', value: auth.key, type: 'string' }, { key: 'value', value: auth.value, type: 'string' }, { key: 'in', value: auth.in, type: 'string' }] };
    default: return undefined;
  }
}

function bodyToPostman(body) {
  switch (body?.mode) {
    case 'json': return { mode: 'raw', raw: body.content ?? '', options: { raw: { language: 'json' } } };
    case 'raw': {
      const ct = body.contentType || '';
      const language = /xml/.test(ct) ? 'xml' : /html/.test(ct) ? 'html' : /javascript/.test(ct) ? 'javascript' : 'text';
      return { mode: 'raw', raw: body.content ?? '', options: { raw: { language } } };
    }
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kvOut(body.fields ?? []) };
    case 'form': return { mode: 'formdata', formdata: kvOut(body.fields ?? []).map((f) => ({ ...f, type: 'text' })) };
    default: return undefined;
  }
}

function requestToPostman(r) {
  const query = kvOut(r.params ?? []);
  const rawUrl = query.length
    ? `${r.url}${r.url.includes('?') ? '&' : '?'}${query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&')}`
    : r.url;
  const request = {
    method: r.method,
    header: kvOut(r.headers ?? []),
    url: { raw: rawUrl, ...(query.length ? { query } : {}) },
  };
  const body = bodyToPostman(r.body);
  if (body) request.body = body;
  const auth = authToPostman(r.auth);
  if (auth) request.auth = auth;
  if (r.description) request.description = r.description;
  return { name: r.name, request, response: [] };
}

/** Serialise a collection (with folders and requests) into Postman v2.1 JSON. */
export function exportCollection(store, collectionId) {
  const collection = store.getCollection(collectionId);
  if (!collection) return null;
  const folders = store.listFolders(collectionId);
  const requests = store.listRequests(collectionId);
  const build = (parentId) => {
    const items = [];
    for (const f of folders.filter((x) => x.parentId === parentId)) items.push({ name: f.name, item: build(f.id) });
    for (const r of requests.filter((x) => x.folderId === parentId)) items.push(requestToPostman(r));
    return items;
  };
  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      description: collection.description || undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: build(null),
  };
}

export function exportEnvironment(env) {
  return {
    id: env.id,
    name: env.name,
    values: env.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled !== false, type: v.secret ? 'secret' : 'default' })),
    _postman_variable_scope: 'environment',
  };
}
