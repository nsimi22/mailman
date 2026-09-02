export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export type BodyMode = 'none' | 'json' | 'raw' | 'form' | 'urlencoded';
export interface Body {
  mode: BodyMode;
  content?: string;
  contentType?: string;
  fields?: KeyValue[];
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';
export interface Auth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: 'header' | 'query';
}

/** Everything that describes a request, independent of where it is stored. */
export interface RequestDraft {
  name: string;
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
  description: string;
}

export interface SavedRequest extends RequestDraft {
  id: string;
  collectionId: string;
  folderId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  sourceUrl: string | null;
  sourceSyncedAt: string | null;
  sourceError: string | null;
  folders: Folder[];
  requests: SavedRequest[];
}

export interface Variable {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
}

export interface SendResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  contentType?: string;
  body?: string;
  bodyEncoding?: 'utf8' | 'base64';
  size?: number;
  time: number;
  redirected?: boolean;
  finalUrl?: string;
  error?: string;
  warnings: string[];
  sent: { method: string; url: string; headers: [string, string][]; body: string | null };
  historyId?: string;
}

export interface HistoryEntry {
  id: string;
  request: Partial<RequestDraft> & { id?: string | null; environmentId?: string | null };
  response: Partial<SendResult>;
  createdAt: string;
}

export const emptyDraft = (): RequestDraft => ({
  name: 'Untitled request',
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'none' },
  description: '',
});

export const draftFromSaved = (r: SavedRequest): RequestDraft => ({
  name: r.name,
  method: r.method,
  url: r.url,
  params: r.params ?? [],
  headers: r.headers ?? [],
  body: r.body ?? { mode: 'none' },
  auth: r.auth ?? { type: 'none' },
  description: r.description ?? '',
});
