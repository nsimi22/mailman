import { useMemo, useState } from 'react';
import type { Collection, Environment, Folder, HistoryEntry, SavedRequest } from '../types';
import { Menu } from './Menu';
import { loadLocal, saveLocal, statusClass, timeAgo } from '../lib/util';

export type SidebarTab = 'collections' | 'environments' | 'history';

export interface SidebarActions {
  createCollection: () => void;
  renameCollection: (c: Collection) => void;
  deleteCollection: (c: Collection) => void;
  exportCollection: (c: Collection) => void;
  createFolder: (collectionId: string, parentId: string | null) => void;
  renameFolder: (f: Folder) => void;
  deleteFolder: (f: Folder) => void;
  newRequest: (collectionId: string, folderId: string | null) => void;
  renameRequest: (r: SavedRequest) => void;
  duplicateRequest: (r: SavedRequest) => void;
  deleteRequest: (r: SavedRequest) => void;
  createEnvironment: () => void;
  editEnvironment: (e: Environment) => void;
  duplicateEnvironment: (e: Environment) => void;
  deleteEnvironment: (e: Environment) => void;
  exportEnvironment: (e: Environment) => void;
  openHistory: (h: HistoryEntry) => void;
  deleteHistory: (h: HistoryEntry) => void;
  clearHistory: () => void;
  importFile: () => void;
}

interface Props {
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  activeRequestId: string | null;
  onOpenRequest: (r: SavedRequest) => void;
  actions: SidebarActions;
}

export function Sidebar(props: Props) {
  const { tab, onTab } = props;
  const [filter, setFilter] = useState('');
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button className={tab === 'collections' ? 'active' : ''} onClick={() => onTab('collections')}>Collections</button>
        <button className={tab === 'environments' ? 'active' : ''} onClick={() => onTab('environments')}>Environments</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => onTab('history')}>History</button>
      </div>
      <div className="sidebar-toolbar">
        <input className="filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {tab === 'collections' && <button className="small" onClick={props.actions.createCollection} title="New collection">+ New</button>}
        {tab === 'collections' && <button className="small" onClick={props.actions.importFile} title="Import a Postman collection or environment">Import</button>}
        {tab === 'environments' && <button className="small" onClick={props.actions.createEnvironment}>+ New</button>}
        {tab === 'history' && props.history.length > 0 && <button className="small" onClick={props.actions.clearHistory}>Clear</button>}
      </div>
      <div className="sidebar-body">
        {tab === 'collections' && <CollectionsPanel {...props} filter={filter.trim().toLowerCase()} />}
        {tab === 'environments' && <EnvironmentsPanel {...props} filter={filter.trim().toLowerCase()} />}
        {tab === 'history' && <HistoryPanel {...props} filter={filter.trim().toLowerCase()} />}
      </div>
    </aside>
  );
}

// ---- collections ---------------------------------------------------------------

function CollectionsPanel({ collections, activeRequestId, onOpenRequest, actions, filter }: Props & { filter: string }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadLocal('mailman.collapsed', {}));
  const toggle = (id: string) => setCollapsed((c) => { const next = { ...c, [id]: !c[id] }; saveLocal('mailman.collapsed', next); return next; });
  const isOpen = (id: string) => (filter ? true : !collapsed[id]);

  if (collections.length === 0) {
    return (
      <div className="empty">
        <p>No collections yet.</p>
        <p><button className="link" onClick={actions.createCollection}>Create one</button> or <button className="link" onClick={actions.importFile}>import from Postman</button>.</p>
      </div>
    );
  }

  const matches = (r: SavedRequest) => !filter || r.name.toLowerCase().includes(filter) || r.url.toLowerCase().includes(filter);

  const renderFolder = (c: Collection, f: Folder, depth: number) => {
    const subfolders = c.folders.filter((x) => x.parentId === f.id);
    const requests = c.requests.filter((x) => x.folderId === f.id && matches(x));
    const hasVisible = requests.length > 0 || subfolders.some((sf) => folderHasMatches(c, sf, matches));
    if (filter && !hasVisible && !f.name.toLowerCase().includes(filter)) return null;
    return (
      <div key={f.id}>
        <div className="tree-row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(f.id)}>
          <span className={`chev ${isOpen(f.id) ? 'open' : ''}`}>▸</span>
          <span className="name">{f.name}</span>
          <Menu items={[
            { label: 'New request', onClick: () => actions.newRequest(c.id, f.id) },
            { label: 'New folder', onClick: () => actions.createFolder(c.id, f.id) },
            { label: 'Rename', onClick: () => actions.renameFolder(f) },
            { label: '', onClick: () => {}, separator: true },
            { label: 'Delete folder', onClick: () => actions.deleteFolder(f), danger: true },
          ]} />
        </div>
        {isOpen(f.id) && (
          <div>
            {subfolders.map((sf) => renderFolder(c, sf, depth + 1))}
            {requests.map((r) => renderRequest(c, r, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderRequest = (c: Collection, r: SavedRequest, depth: number) => (
    <div key={r.id} className={`tree-row request ${r.id === activeRequestId ? 'active' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onOpenRequest(r)} title={r.url}>
      <span className={`method m-${r.method}`}>{shortMethod(r.method)}</span>
      <span className="name">{r.name}</span>
      <Menu items={[
        { label: 'Rename', onClick: () => actions.renameRequest(r) },
        { label: 'Duplicate', onClick: () => actions.duplicateRequest(r) },
        { label: '', onClick: () => {}, separator: true },
        { label: 'Delete request', onClick: () => actions.deleteRequest(r), danger: true },
      ]} />
    </div>
  );

  return (
    <div className="tree">
      {collections.map((c) => {
        const rootFolders = c.folders.filter((f) => f.parentId === null);
        const rootRequests = c.requests.filter((r) => r.folderId === null && matches(r));
        const anyMatch = !filter || c.name.toLowerCase().includes(filter) || c.requests.some(matches);
        if (!anyMatch) return null;
        return (
          <div key={c.id} className="collection">
            <div className="tree-row collection-row" onClick={() => toggle(c.id)}>
              <span className={`chev ${isOpen(c.id) ? 'open' : ''}`}>▸</span>
              <span className="name">{c.name}</span>
              <span className="count">{c.requests.length}</span>
              <Menu items={[
                { label: 'New request', onClick: () => actions.newRequest(c.id, null) },
                { label: 'New folder', onClick: () => actions.createFolder(c.id, null) },
                { label: 'Rename', onClick: () => actions.renameCollection(c) },
                { label: 'Export (Postman v2.1)', onClick: () => actions.exportCollection(c) },
                { label: '', onClick: () => {}, separator: true },
                { label: 'Delete collection', onClick: () => actions.deleteCollection(c), danger: true },
              ]} />
            </div>
            {isOpen(c.id) && (
              <div>
                {rootFolders.map((f) => renderFolder(c, f, 1))}
                {rootRequests.map((r) => renderRequest(c, r, 1))}
                {c.requests.length === 0 && c.folders.length === 0 && (
                  <div className="tree-hint">Empty. <button className="link" onClick={() => actions.newRequest(c.id, null)}>Add a request</button></div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function folderHasMatches(c: Collection, f: Folder, matches: (r: SavedRequest) => boolean): boolean {
  if (c.requests.some((r) => r.folderId === f.id && matches(r))) return true;
  return c.folders.filter((x) => x.parentId === f.id).some((sf) => folderHasMatches(c, sf, matches));
}

export function shortMethod(m: string) {
  return { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PAT' }[m] ?? m;
}

// ---- environments --------------------------------------------------------------

function EnvironmentsPanel({ environments, activeEnvironmentId, actions, filter }: Props & { filter: string }) {
  const list = environments.filter((e) => !filter || e.name.toLowerCase().includes(filter));
  if (environments.length === 0) {
    return (
      <div className="empty">
        <p>No environments yet.</p>
        <p>Environments hold variables like <code>{'{{baseUrl}}'}</code> that you can use anywhere in a request.</p>
        <p><button className="link" onClick={actions.createEnvironment}>Create one</button></p>
      </div>
    );
  }
  return (
    <div className="tree">
      {list.map((e) => (
        <div key={e.id} className={`tree-row env ${e.id === activeEnvironmentId ? 'active' : ''}`} onClick={() => actions.editEnvironment(e)}>
          <span className="dot" />
          <span className="name">{e.name}</span>
          <span className="count">{e.variables.length}</span>
          <Menu items={[
            { label: 'Edit', onClick: () => actions.editEnvironment(e) },
            { label: 'Duplicate', onClick: () => actions.duplicateEnvironment(e) },
            { label: 'Export (Postman)', onClick: () => actions.exportEnvironment(e) },
            { label: '', onClick: () => {}, separator: true },
            { label: 'Delete environment', onClick: () => actions.deleteEnvironment(e), danger: true },
          ]} />
        </div>
      ))}
    </div>
  );
}

// ---- history ---------------------------------------------------------------------

function HistoryPanel({ history, actions, filter }: Props & { filter: string }) {
  const list = useMemo(() => history.filter((h) => !filter || (h.request.url ?? '').toLowerCase().includes(filter) || (h.request.name ?? '').toLowerCase().includes(filter)), [history, filter]);
  if (history.length === 0) return <div className="empty"><p>Requests you send will show up here.</p></div>;
  return (
    <div className="tree">
      {list.map((h) => (
        <div key={h.id} className="tree-row history" onClick={() => actions.openHistory(h)} title={h.request.url}>
          <span className={`method m-${h.request.method}`}>{shortMethod(h.request.method ?? 'GET')}</span>
          <span className="name">{h.request.url || '(no url)'}</span>
          <span className={`status ${h.response.ok === false ? 'err' : statusClass(h.response.status)}`}>{h.response.ok === false ? 'ERR' : h.response.status}</span>
          <span className="count">{timeAgo(h.createdAt)}</span>
          <Menu items={[{ label: 'Remove', onClick: () => actions.deleteHistory(h), danger: true }]} />
        </div>
      ))}
    </div>
  );
}
