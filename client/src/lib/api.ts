import type { Collection, Environment, HistoryEntry, RequestDraft, SavedRequest, SendResult, Variable, Folder } from '../types';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data as T;
}

export const api = {
  collections: {
    list: () => call<Collection[]>('GET', '/collections'),
    create: (name: string) => call<Collection>('POST', '/collections', { name }),
    update: (id: string, patch: { name?: string; description?: string }) => call<Collection>('PATCH', `/collections/${id}`, patch),
    remove: (id: string) => call<void>('DELETE', `/collections/${id}`),
    exportUrl: (id: string) => `/api/collections/${id}/export`,
    linkOpenApi: (url: string, name?: string) => call<Collection>('POST', '/collections/from-openapi', { url, name: name || undefined }),
    sync: (id: string) => call<Collection & { synced: number }>('POST', `/collections/${id}/sync`),
    unlink: (id: string) => call<Collection>('PATCH', `/collections/${id}`, { sourceUrl: null }),
  },
  folders: {
    create: (collectionId: string, name: string, parentId: string | null) => call<Folder>('POST', '/folders', { collectionId, name, parentId }),
    update: (id: string, patch: { name?: string; parentId?: string | null }) => call<Folder>('PATCH', `/folders/${id}`, patch),
    remove: (id: string) => call<void>('DELETE', `/folders/${id}`),
  },
  requests: {
    create: (data: RequestDraft & { collectionId: string; folderId: string | null }) => call<SavedRequest>('POST', '/requests', data),
    update: (id: string, patch: Partial<RequestDraft> & { collectionId?: string; folderId?: string | null }) => call<SavedRequest>('PATCH', `/requests/${id}`, patch),
    remove: (id: string) => call<void>('DELETE', `/requests/${id}`),
  },
  environments: {
    list: () => call<Environment[]>('GET', '/environments'),
    create: (name: string, variables: Variable[] = []) => call<Environment>('POST', '/environments', { name, variables }),
    update: (id: string, patch: { name?: string; variables?: Variable[] }) => call<Environment>('PATCH', `/environments/${id}`, patch),
    remove: (id: string) => call<void>('DELETE', `/environments/${id}`),
    exportUrl: (id: string) => `/api/environments/${id}/export`,
  },
  history: {
    list: (limit = 100) => call<HistoryEntry[]>('GET', `/history?limit=${limit}`),
    clear: () => call<void>('DELETE', '/history'),
    remove: (id: string) => call<void>('DELETE', `/history/${id}`),
  },
  send: (request: RequestDraft & { id?: string }, environmentId: string | null) =>
    call<SendResult>('POST', '/send', { request, environmentId }),
  curl: (request: RequestDraft, environmentId: string | null) =>
    call<{ curl: string; warnings: string[] }>('POST', '/curl', { request, environmentId }),
  import: (json: unknown) => call<{ type: 'collection' | 'environment' }>('POST', '/import', json),
};
