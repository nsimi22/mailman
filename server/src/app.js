import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { prepareRequest, executeRequest, toCurl, variablesToMap } from './send.js';
import { importCollection, exportCollection, parseEnvironment, isPostmanEnvironment, exportEnvironment } from './postman.js';
import { applySpecToCollection, fetchSpec, isOpenApiDocument, specTitle, syncCollection } from './openapi.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function basicAuthGate(password) {
  const expected = Buffer.from(password);
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const supplied = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
      if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="mailman", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

/**
 * Build the Express application.
 * @param {import('./db.js').Store} store
 * @param {{ password?: string, staticDir?: string, requestTimeoutMs?: number }} options
 */
export function createApp(store, { password, staticDir, requestTimeoutMs = 30_000 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (password) app.use(basicAuthGate(password));
  app.use(express.json({ limit: '20mb' }));

  const api = express.Router();

  // ---- collections (returned as a tree) ------------------------------------
  api.get('/collections', (req, res) => {
    const collections = store.listCollections();
    const folders = store.listFolders();
    const requests = store.listRequests();
    res.json(collections.map((c) => ({
      ...c,
      folders: folders.filter((f) => f.collectionId === c.id),
      requests: requests.filter((r) => r.collectionId === c.id),
    })));
  });
  api.post('/collections', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw bad('Collection name is required');
    res.status(201).json(store.createCollection({ name, description: String(req.body?.description ?? '') }));
  });
  api.patch('/collections/:id', (req, res) => {
    const patch = {};
    if (req.body?.name != null) patch.name = String(req.body.name).trim() || 'Untitled';
    if (req.body?.description != null) patch.description = String(req.body.description);
    if (req.body?.sortOrder != null) patch.sortOrder = Number(req.body.sortOrder) || 0;
    if ('sourceUrl' in (req.body ?? {})) {
      const url = req.body.sourceUrl ? String(req.body.sourceUrl).trim() : null;
      if (url && !/^https?:\/\//i.test(url)) throw bad('sourceUrl must start with http:// or https://');
      patch.sourceUrl = url;
      if (!url) { patch.sourceError = null; patch.sourceSyncedAt = null; }
    }
    const c = store.updateCollection(req.params.id, patch);
    if (!c) throw notFound('Collection');
    res.json(c);
  });
  api.delete('/collections/:id', (req, res) => {
    if (!store.deleteCollection(req.params.id)) throw notFound('Collection');
    res.status(204).end();
  });
  api.get('/collections/:id/export', (req, res) => {
    const json = exportCollection(store, req.params.id);
    if (!json) throw notFound('Collection');
    res.set('Content-Disposition', `attachment; filename="${safeFilename(json.info.name)}.postman_collection.json"`);
    res.json(json);
  });

  // ---- OpenAPI-linked collections ------------------------------------------
  api.post('/collections/from-openapi', wrap(async (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw bad('Spec URL must start with http:// or https://');
    let spec;
    try { spec = await fetchSpec(url); } catch (err) { throw bad(err.message); }
    const name = String(req.body?.name ?? '').trim() || specTitle(spec);
    const collection = store.createCollection({ name, description: `Synced from ${url}`, sourceUrl: url });
    applySpecToCollection(store, collection.id, spec);
    res.status(201).json({ ...store.getCollection(collection.id), folders: store.listFolders(collection.id), requests: store.listRequests(collection.id) });
  }));
  api.post('/collections/:id/sync', wrap(async (req, res) => {
    const c = store.getCollection(req.params.id);
    if (!c) throw notFound('Collection');
    if (!c.sourceUrl) throw bad('This collection is not linked to a spec');
    const r = await syncCollection(store, c);
    if (!r.ok) throw bad(r.error);
    res.json({ ...store.getCollection(c.id), synced: r.count });
  }));

  // ---- import (Postman collection / environment, or an OpenAPI document) ---
  api.post('/import', (req, res) => {
    const json = req.body;
    if (isOpenApiDocument(json)) {
      const collection = store.createCollection({ name: specTitle(json) });
      applySpecToCollection(store, collection.id, json);
      return res.status(201).json({ type: 'collection', collection: store.getCollection(collection.id) });
    }
    if (isPostmanEnvironment(json)) {
      const env = store.createEnvironment(parseEnvironment(json));
      return res.status(201).json({ type: 'environment', environment: env });
    }
    try {
      const collection = importCollection(store, json);
      res.status(201).json({ type: 'collection', collection });
    } catch (err) {
      throw bad(err.message);
    }
  });

  // ---- folders -------------------------------------------------------------
  api.post('/folders', (req, res) => {
    const { collectionId, parentId = null } = req.body ?? {};
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw bad('Folder name is required');
    if (!store.getCollection(collectionId)) throw bad('Unknown collectionId');
    if (parentId && !store.getFolder(parentId)) throw bad('Unknown parentId');
    res.status(201).json(store.createFolder({ collectionId, parentId, name }));
  });
  api.patch('/folders/:id', (req, res) => {
    const patch = {};
    if (req.body?.name != null) patch.name = String(req.body.name).trim() || 'Untitled';
    if ('parentId' in (req.body ?? {})) patch.parentId = req.body.parentId || null;
    if (req.body?.sortOrder != null) patch.sortOrder = Number(req.body.sortOrder) || 0;
    const f = store.updateFolder(req.params.id, patch);
    if (!f) throw notFound('Folder');
    res.json(f);
  });
  api.delete('/folders/:id', (req, res) => {
    if (!store.deleteFolder(req.params.id)) throw notFound('Folder');
    res.status(204).end();
  });

  // ---- requests ------------------------------------------------------------
  api.get('/requests/:id', (req, res) => {
    const r = store.getRequest(req.params.id);
    if (!r) throw notFound('Request');
    res.json(r);
  });
  api.post('/requests', (req, res) => {
    const data = req.body ?? {};
    if (!store.getCollection(data.collectionId)) throw bad('Unknown collectionId');
    if (data.folderId && !store.getFolder(data.folderId)) throw bad('Unknown folderId');
    res.status(201).json(store.createRequest(data));
  });
  api.patch('/requests/:id', (req, res) => {
    const data = req.body ?? {};
    if (data.collectionId && !store.getCollection(data.collectionId)) throw bad('Unknown collectionId');
    if (data.folderId && !store.getFolder(data.folderId)) throw bad('Unknown folderId');
    const r = store.updateRequest(req.params.id, data);
    if (!r) throw notFound('Request');
    res.json(r);
  });
  api.delete('/requests/:id', (req, res) => {
    if (!store.deleteRequest(req.params.id)) throw notFound('Request');
    res.status(204).end();
  });

  // ---- environments --------------------------------------------------------
  api.get('/environments', (req, res) => res.json(store.listEnvironments()));
  api.post('/environments', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw bad('Environment name is required');
    res.status(201).json(store.createEnvironment({ name, variables: req.body?.variables }));
  });
  api.patch('/environments/:id', (req, res) => {
    const patch = {};
    if (req.body?.name != null) patch.name = String(req.body.name).trim() || 'Untitled';
    if (req.body?.variables != null) patch.variables = req.body.variables;
    const e = store.updateEnvironment(req.params.id, patch);
    if (!e) throw notFound('Environment');
    res.json(e);
  });
  api.delete('/environments/:id', (req, res) => {
    if (!store.deleteEnvironment(req.params.id)) throw notFound('Environment');
    res.status(204).end();
  });
  api.get('/environments/:id/export', (req, res) => {
    const env = store.getEnvironment(req.params.id);
    if (!env) throw notFound('Environment');
    res.set('Content-Disposition', `attachment; filename="${safeFilename(env.name)}.postman_environment.json"`);
    res.json(exportEnvironment(env));
  });

  // ---- history -------------------------------------------------------------
  api.get('/history', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(store.listHistory(limit));
  });
  api.delete('/history', (req, res) => { store.clearHistory(); res.status(204).end(); });
  api.delete('/history/:id', (req, res) => {
    if (!store.deleteHistory(req.params.id)) throw notFound('History entry');
    res.status(204).end();
  });

  // ---- send ----------------------------------------------------------------
  const resolveVars = (environmentId) => {
    if (!environmentId) return {};
    const env = store.getEnvironment(environmentId);
    if (!env) throw bad('Unknown environmentId');
    return variablesToMap(env.variables);
  };

  api.post('/send', wrap(async (req, res) => {
    const { request, environmentId, saveHistory = true } = req.body ?? {};
    if (!request || typeof request !== 'object') throw bad('Missing request');
    if (!String(request.url ?? '').trim()) throw bad('URL is required');
    const vars = resolveVars(environmentId);
    const prepared = prepareRequest(request, vars);
    const response = await executeRequest(prepared, { timeoutMs: requestTimeoutMs });
    const payload = {
      ...response,
      warnings: prepared.warnings,
      sent: {
        method: prepared.method,
        url: prepared.url,
        headers: prepared.headers,
        body: prepared.bodyDescription,
      },
    };
    if (saveHistory) {
      const { body: _b, ...summary } = response;
      const bodyPreview = typeof response.body === 'string' ? response.body.slice(0, 200_000) : undefined;
      payload.historyId = store.addHistory({
        request: {
          id: request.id ?? null,
          name: request.name ?? null,
          method: request.method,
          url: request.url,
          params: request.params,
          headers: request.headers,
          body: request.body,
          auth: request.auth,
          environmentId: environmentId ?? null,
        },
        response: { ...summary, body: bodyPreview },
      });
    }
    res.json(payload);
  }));

  api.post('/curl', (req, res) => {
    const { request, environmentId } = req.body ?? {};
    if (!request || typeof request !== 'object') throw bad('Missing request');
    const prepared = prepareRequest(request, resolveVars(environmentId));
    res.json({ curl: toCurl(prepared), warnings: prepared.warnings });
  });

  api.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---- static client -------------------------------------------------------
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html' }));
    app.get('*', (req, res) => res.sendFile(join(staticDir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text').send('mailman API is running. Build the client (npm run build) to serve the UI from here.'));
  }

  // ---- errors --------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  return app;
}

function safeFilename(name) {
  return String(name).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'export';
}
