/**
 * Turn an OpenAPI 3.x or Swagger 2.0 document into mailman requests, so a collection can be
 * kept in sync with a service's spec: whenever an endpoint is added, it shows up here.
 */

export function isOpenApiDocument(json) {
  return !!json && typeof json === 'object' && (typeof json.openapi === 'string' || typeof json.swagger === 'string') && json.paths && typeof json.paths === 'object';
}

/** Minimal YAML support: many services publish YAML specs. Try JSON first, then a small YAML subset via js-yaml if present. */
export async function parseSpecText(text) {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* not JSON */ }
  try {
    const yaml = await import('yaml');
    return yaml.parse(t);
  } catch (err) {
    throw new Error('Spec is not valid JSON, and YAML parsing is unavailable: ' + (err?.message || err));
  }
}

export async function fetchSpec(url, { timeoutMs = 15_000 } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json, application/yaml, text/yaml, */*' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Spec URL answered ${res.status} ${res.statusText}`);
  const json = await parseSpecText(await res.text());
  if (!isOpenApiDocument(json)) throw new Error('That URL did not return an OpenAPI / Swagger document.');
  return json;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function deref(spec, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    const target = node.$ref.slice(2).split('/').reduce((acc, k) => (acc ? acc[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
    return deref(spec, target, depth + 1);
  }
  return node;
}

/** Build a plausible example value from a JSON schema. */
export function exampleFromSchema(spec, schema, depth = 0) {
  schema = deref(spec, schema, depth);
  if (!schema || typeof schema !== 'object' || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const variants = schema.oneOf || schema.anyOf || schema.allOf;
  if (Array.isArray(variants) && variants.length) {
    if (schema.allOf) return Object.assign({}, ...variants.map((v) => exampleFromSchema(spec, v, depth + 1)).filter((v) => v && typeof v === 'object'));
    return exampleFromSchema(spec, variants[0], depth + 1);
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type || (schema.properties ? 'object' : schema.items ? 'array' : 'string');
  switch (type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = exampleFromSchema(spec, v, depth + 1);
      return out;
    }
    case 'array': return [exampleFromSchema(spec, schema.items ?? {}, depth + 1)];
    case 'integer': return 0;
    case 'number': return 0;
    case 'boolean': return true;
    case 'null': return null;
    default: {
      const f = schema.format;
      if (f === 'date-time') return '2024-01-01T00:00:00Z';
      if (f === 'date') return '2024-01-01';
      if (f === 'email') return 'user@example.com';
      if (f === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (f === 'uri' || f === 'url') return 'https://example.com';
      return 'string';
    }
  }
}

function authFromSpec(spec, operation) {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const requirements = operation.security ?? spec.security ?? [];
  for (const req of requirements) {
    for (const name of Object.keys(req ?? {})) {
      const s = deref(spec, schemes[name]);
      if (!s) continue;
      if (s.type === 'http' && /^bearer$/i.test(s.scheme ?? '')) return { type: 'bearer', token: '{{token}}' };
      if (s.type === 'http' && /^basic$/i.test(s.scheme ?? '')) return { type: 'basic', username: '{{username}}', password: '{{password}}' };
      if (s.type === 'oauth2' || s.type === 'openIdConnect') return { type: 'bearer', token: '{{token}}' };
      if (s.type === 'apiKey') return { type: 'apikey', key: s.name || 'X-API-Key', value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' };
      if (s.type === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    }
  }
  return { type: 'none' };
}

function bodyFromOperation(spec, operation, pathItem) {
  // OpenAPI 3
  const rb = deref(spec, operation.requestBody);
  if (rb?.content) {
    const entries = Object.entries(rb.content);
    const pick = (re) => entries.find(([ct]) => re.test(ct));
    const json = pick(/json/i);
    if (json) {
      const media = json[1];
      const example = media.example ?? (media.examples && Object.values(media.examples)[0]?.value) ?? exampleFromSchema(spec, media.schema);
      return { mode: 'json', content: JSON.stringify(example ?? {}, null, 2) };
    }
    const form = pick(/x-www-form-urlencoded/i);
    if (form) return { mode: 'urlencoded', fields: fieldsFromSchema(spec, form[1].schema) };
    const multipart = pick(/multipart/i);
    if (multipart) return { mode: 'form', fields: fieldsFromSchema(spec, multipart[1].schema) };
    if (entries.length) return { mode: 'raw', content: '', contentType: entries[0][0] };
  }
  // Swagger 2: body / formData parameters
  const params = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((p) => deref(spec, p));
  const bodyParam = params.find((p) => p.in === 'body');
  if (bodyParam) return { mode: 'json', content: JSON.stringify(exampleFromSchema(spec, bodyParam.schema) ?? {}, null, 2) };
  const formParams = params.filter((p) => p.in === 'formData');
  if (formParams.length) {
    const multipart = (operation.consumes ?? spec.consumes ?? []).some((c) => /multipart/i.test(c));
    return { mode: multipart ? 'form' : 'urlencoded', fields: formParams.map((p) => ({ key: p.name, value: String(exampleFromSchema(spec, p) ?? ''), enabled: p.required === true })) };
  }
  return { mode: 'none' };
}

function fieldsFromSchema(spec, schema) {
  schema = deref(spec, schema);
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([k, v]) => {
    const ex = exampleFromSchema(spec, v);
    return { key: k, value: typeof ex === 'object' ? JSON.stringify(ex) : String(ex ?? ''), enabled: required.has(k) || required.size === 0 };
  });
}

const paramValue = (spec, p) => {
  const ex = p.example ?? (p.examples && Object.values(p.examples)[0]?.value) ?? exampleFromSchema(spec, p.schema ?? p);
  return ex == null ? '' : typeof ex === 'object' ? JSON.stringify(ex) : String(ex);
};

/**
 * Extract requests from a spec. Each request carries a stable `sourceKey` ("METHOD /path") so
 * re-syncs can update in place. Folders follow the operation's first tag (or the first path segment).
 * URLs use {{baseUrl}} so environments pick the server.
 */
export function requestsFromSpec(spec) {
  const out = [];
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    const pathItem = deref(spec, rawItem) ?? {};
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(spec, p)).filter((p) => p && p.name);
      const query = params.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: paramValue(spec, p), enabled: p.required === true, ...(p.description ? { description: String(p.description) } : {}) }));
      const headers = params.filter((p) => p.in === 'header').map((p) => ({ key: p.name, value: paramValue(spec, p), enabled: p.required === true }));
      const url = '{{baseUrl}}' + path.replace(/\{([^}]+)\}/g, (_, name) => `{{${name}}}`);
      const folder = (Array.isArray(op.tags) && op.tags[0]) || path.split('/').filter(Boolean)[0] || null;
      const summary = op.summary || op.operationId || `${method.toUpperCase()} ${path}`;
      const descriptionParts = [op.description, ...params.filter((p) => p.in === 'path').map((p) => `Path param {{${p.name}}}${p.description ? `: ${p.description}` : ''}`)].filter(Boolean);
      out.push({
        sourceKey: `${method.toUpperCase()} ${path}`,
        folder: folder ? String(folder) : null,
        name: String(summary),
        method: method.toUpperCase(),
        url,
        params: query,
        headers,
        body: bodyFromOperation(spec, op, pathItem),
        auth: authFromSpec(spec, op),
        description: descriptionParts.join('\n'),
        deprecated: op.deprecated === true,
      });
    }
  }
  return out;
}

export function specTitle(spec) {
  return String(spec.info?.title || 'API');
}

/** Extract the server base URL from the spec, if it declares one, for seeding an environment hint. */
export function specBaseUrl(spec) {
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) return String(spec.servers[0].url);
  if (spec.host) return `${(spec.schemes && spec.schemes[0]) || 'https'}://${spec.host}${spec.basePath || ''}`;
  return null;
}

/**
 * Apply a spec to a collection: upsert requests by sourceKey, place them in tag folders,
 * remove requests the spec no longer has. Returns the number of endpoints synced.
 */
export function applySpecToCollection(store, collectionId, spec) {
  const desired = requestsFromSpec(spec);
  return store.transaction(() => {
    const existingFolders = store.listFolders(collectionId).filter((f) => f.parentId === null);
    const folderByName = new Map(existingFolders.map((f) => [f.name, f]));
    const existing = store.listRequests(collectionId);
    const byKey = new Map(existing.filter((r) => r.sourceKey).map((r) => [r.sourceKey, r]));
    const seen = new Set();

    for (const d of desired) {
      let folderId = null;
      if (d.folder) {
        let f = folderByName.get(d.folder);
        if (!f) { f = store.createFolder({ collectionId, parentId: null, name: d.folder }); folderByName.set(d.folder, f); }
        folderId = f.id;
      }
      const { folder, deprecated, ...data } = d;
      const name = deprecated ? `${d.name} (deprecated)` : d.name;
      const cur = byKey.get(d.sourceKey);
      if (cur) store.updateRequest(cur.id, { ...data, name, folderId });
      else store.createRequest({ ...data, name, collectionId, folderId });
      seen.add(d.sourceKey);
    }
    for (const r of existing) if (r.sourceKey && !seen.has(r.sourceKey)) store.deleteRequest(r.id);
    // drop empty tag folders left behind
    for (const f of store.listFolders(collectionId)) {
      if (f.parentId === null && !store.listRequests(collectionId).some((r) => r.folderId === f.id) && !store.listFolders(collectionId).some((x) => x.parentId === f.id)) store.deleteFolder(f.id);
    }
    store.updateCollection(collectionId, { sourceSyncedAt: new Date().toISOString(), sourceError: null });
    return desired.length;
  });
}

/** Fetch and apply the spec a collection is linked to. Records errors on the collection instead of throwing. */
export async function syncCollection(store, collection) {
  try {
    const spec = await fetchSpec(collection.sourceUrl);
    const count = applySpecToCollection(store, collection.id, spec);
    return { ok: true, count };
  } catch (err) {
    store.updateCollection(collection.id, { sourceError: err.message || String(err) });
    return { ok: false, error: err.message || String(err) };
  }
}

/** Sync every linked collection. Used by the background timer. */
export async function syncAllLinked(store, log = () => {}) {
  for (const c of store.listCollections().filter((c) => c.sourceUrl)) {
    const r = await syncCollection(store, c);
    log(r.ok ? `synced "${c.name}" (${r.count} endpoints)` : `sync failed for "${c.name}": ${r.error}`);
  }
}
