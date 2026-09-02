import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL DEFAULT '[]',
  headers TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL DEFAULT '{"mode":"none"}',
  auth TEXT NOT NULL DEFAULT '{"type":"none"}',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_collection ON folders(collection_id);
CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests(folder_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);
`;

const now = () => new Date().toISOString();
const parse = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return new Store(db);
}

const rowToRequest = (r) => r && ({
  id: r.id,
  collectionId: r.collection_id,
  folderId: r.folder_id,
  name: r.name,
  method: r.method,
  url: r.url,
  params: parse(r.params, []),
  headers: parse(r.headers, []),
  body: parse(r.body, { mode: 'none' }),
  auth: parse(r.auth, { type: 'none' }),
  description: r.description,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const rowToFolder = (f) => f && ({
  id: f.id,
  collectionId: f.collection_id,
  parentId: f.parent_id,
  name: f.name,
  sortOrder: f.sort_order,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
});
const rowToCollection = (c) => c && ({
  id: c.id,
  name: c.name,
  description: c.description,
  sortOrder: c.sort_order,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});
const rowToEnvironment = (e) => e && ({
  id: e.id,
  name: e.name,
  variables: parse(e.variables, []),
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});
const rowToHistory = (h) => h && ({
  id: h.id,
  request: parse(h.request, {}),
  response: parse(h.response, {}),
  createdAt: h.created_at,
});

export class Store {
  constructor(db) {
    this.db = db;
  }

  close() { this.db.close(); }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- collections ---------------------------------------------------------
  listCollections() {
    return this.db.prepare('SELECT * FROM collections ORDER BY sort_order, created_at').all().map(rowToCollection);
  }
  getCollection(id) {
    return rowToCollection(this.db.prepare('SELECT * FROM collections WHERE id = ?').get(id));
  }
  createCollection({ name, description = '' }) {
    const id = randomUUID();
    const ts = now();
    const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM collections').get().n;
    this.db.prepare('INSERT INTO collections (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, description, order, ts, ts);
    return this.getCollection(id);
  }
  updateCollection(id, patch) {
    const cur = this.getCollection(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE collections SET name = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, next.sortOrder, now(), id);
    return this.getCollection(id);
  }
  deleteCollection(id) {
    return this.db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0;
  }

  // ---- folders -------------------------------------------------------------
  listFolders(collectionId) {
    const sql = collectionId
      ? 'SELECT * FROM folders WHERE collection_id = ? ORDER BY sort_order, created_at'
      : 'SELECT * FROM folders ORDER BY sort_order, created_at';
    const stmt = this.db.prepare(sql);
    return (collectionId ? stmt.all(collectionId) : stmt.all()).map(rowToFolder);
  }
  getFolder(id) {
    return rowToFolder(this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id));
  }
  createFolder({ collectionId, parentId = null, name }) {
    const id = randomUUID();
    const ts = now();
    const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM folders WHERE collection_id = ? AND parent_id IS ?').get(collectionId, parentId).n;
    this.db.prepare('INSERT INTO folders (id, collection_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, collectionId, parentId, name, order, ts, ts);
    return this.getFolder(id);
  }
  updateFolder(id, patch) {
    const cur = this.getFolder(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.parentId, next.sortOrder, now(), id);
    return this.getFolder(id);
  }
  deleteFolder(id) {
    return this.db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0;
  }

  // ---- requests ------------------------------------------------------------
  listRequests(collectionId) {
    const sql = collectionId
      ? 'SELECT * FROM requests WHERE collection_id = ? ORDER BY sort_order, created_at'
      : 'SELECT * FROM requests ORDER BY sort_order, created_at';
    const stmt = this.db.prepare(sql);
    return (collectionId ? stmt.all(collectionId) : stmt.all()).map(rowToRequest);
  }
  getRequest(id) {
    return rowToRequest(this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id));
  }
  createRequest(data) {
    const id = randomUUID();
    const ts = now();
    const r = normalizeRequest(data);
    const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM requests WHERE collection_id = ? AND folder_id IS ?').get(r.collectionId, r.folderId).n;
    this.db.prepare(`INSERT INTO requests
      (id, collection_id, folder_id, name, method, url, params, headers, body, auth, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.collectionId, r.folderId, r.name, r.method, r.url,
        JSON.stringify(r.params), JSON.stringify(r.headers), JSON.stringify(r.body), JSON.stringify(r.auth),
        r.description, order, ts, ts);
    return this.getRequest(id);
  }
  updateRequest(id, patch) {
    const cur = this.getRequest(id);
    if (!cur) return null;
    const r = normalizeRequest({ ...cur, ...patch });
    this.db.prepare(`UPDATE requests SET collection_id = ?, folder_id = ?, name = ?, method = ?, url = ?, params = ?, headers = ?,
      body = ?, auth = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?`)
      .run(r.collectionId, r.folderId, r.name, r.method, r.url,
        JSON.stringify(r.params), JSON.stringify(r.headers), JSON.stringify(r.body), JSON.stringify(r.auth),
        r.description, r.sortOrder ?? cur.sortOrder, now(), id);
    return this.getRequest(id);
  }
  deleteRequest(id) {
    return this.db.prepare('DELETE FROM requests WHERE id = ?').run(id).changes > 0;
  }

  // ---- environments --------------------------------------------------------
  listEnvironments() {
    return this.db.prepare('SELECT * FROM environments ORDER BY created_at').all().map(rowToEnvironment);
  }
  getEnvironment(id) {
    return rowToEnvironment(this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id));
  }
  createEnvironment({ name, variables = [] }) {
    const id = randomUUID();
    const ts = now();
    this.db.prepare('INSERT INTO environments (id, name, variables, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(normalizeVariables(variables)), ts, ts);
    return this.getEnvironment(id);
  }
  updateEnvironment(id, patch) {
    const cur = this.getEnvironment(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE environments SET name = ?, variables = ?, updated_at = ? WHERE id = ?')
      .run(next.name, JSON.stringify(normalizeVariables(next.variables)), now(), id);
    return this.getEnvironment(id);
  }
  deleteEnvironment(id) {
    return this.db.prepare('DELETE FROM environments WHERE id = ?').run(id).changes > 0;
  }

  // ---- history -------------------------------------------------------------
  listHistory(limit = 100) {
    return this.db.prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT ?').all(limit).map(rowToHistory);
  }
  addHistory({ request, response }) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO history (id, request, response, created_at) VALUES (?, ?, ?, ?)')
      .run(id, JSON.stringify(request), JSON.stringify(response), now());
    // keep the table bounded
    this.db.prepare('DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY created_at DESC LIMIT -1 OFFSET 500)').run();
    return id;
  }
  clearHistory() {
    this.db.prepare('DELETE FROM history').run();
  }
  deleteHistory(id) {
    return this.db.prepare('DELETE FROM history WHERE id = ?').run(id).changes > 0;
  }
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function normalizeKeyValues(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((kv) => kv && typeof kv === 'object')
    .map((kv) => ({
      key: String(kv.key ?? ''),
      value: String(kv.value ?? ''),
      enabled: kv.enabled !== false,
      ...(kv.description ? { description: String(kv.description) } : {}),
    }));
}

export function normalizeVariables(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      key: String(v.key ?? ''),
      value: String(v.value ?? ''),
      enabled: v.enabled !== false,
      secret: v.secret === true,
    }));
}

export function normalizeBody(body) {
  const b = body && typeof body === 'object' ? body : { mode: 'none' };
  const mode = ['none', 'json', 'raw', 'form', 'urlencoded'].includes(b.mode) ? b.mode : 'none';
  const out = { mode };
  if (mode === 'json' || mode === 'raw') out.content = String(b.content ?? '');
  if (mode === 'raw') out.contentType = String(b.contentType ?? 'text/plain');
  if (mode === 'form' || mode === 'urlencoded') out.fields = normalizeKeyValues(b.fields);
  return out;
}

export function normalizeAuth(auth) {
  const a = auth && typeof auth === 'object' ? auth : { type: 'none' };
  switch (a.type) {
    case 'bearer': return { type: 'bearer', token: String(a.token ?? '') };
    case 'basic': return { type: 'basic', username: String(a.username ?? ''), password: String(a.password ?? '') };
    case 'apikey': return {
      type: 'apikey',
      key: String(a.key ?? ''),
      value: String(a.value ?? ''),
      in: a.in === 'query' ? 'query' : 'header',
    };
    default: return { type: 'none' };
  }
}

export function normalizeRequest(data) {
  const method = String(data.method ?? 'GET').toUpperCase();
  return {
    collectionId: data.collectionId,
    folderId: data.folderId ?? null,
    name: String(data.name ?? 'Untitled request'),
    method: METHODS.includes(method) ? method : 'GET',
    url: String(data.url ?? ''),
    params: normalizeKeyValues(data.params),
    headers: normalizeKeyValues(data.headers),
    body: normalizeBody(data.body),
    auth: normalizeAuth(data.auth),
    description: String(data.description ?? ''),
    sortOrder: data.sortOrder,
  };
}
