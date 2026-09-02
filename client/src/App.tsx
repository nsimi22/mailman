import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import { desktop } from './lib/desktop';
import { copyText, loadLocal, saveLocal, uid } from './lib/util';
import { draftFromSaved, emptyDraft, type Collection, type Environment, type Folder, type HistoryEntry, type RequestDraft, type SavedRequest, type SendResult } from './types';
import { Sidebar, type SidebarActions, type SidebarTab, shortMethod } from './components/Sidebar';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { ConfirmDialog, PromptDialog, SaveDialog, type SaveTarget } from './components/Dialogs';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { ImportDialog } from './components/ImportDialog';
import { WorkspaceDialog } from './components/WorkspaceDialog';

interface Tab {
  id: string;
  requestId: string | null;
  collectionId: string | null;
  folderId: string | null;
  draft: RequestDraft;
  saved: RequestDraft | null; // last persisted snapshot, for the dirty indicator
}

interface PersistedTabs { tabs: Tab[]; activeTabId: string | null }

type Dialog =
  | { kind: 'prompt'; title: string; label: string; initial?: string; submitLabel?: string; onSubmit: (v: string) => void }
  | { kind: 'confirm'; title: string; message: string; onConfirm: () => void }
  | { kind: 'save'; tabId: string }
  | { kind: 'environment'; environment: Environment | null }
  | { kind: 'import' }
  | { kind: 'workspace' };

const newTab = (draft: RequestDraft = emptyDraft(), extra: Partial<Tab> = {}): Tab => ({ id: uid(), requestId: null, collectionId: null, folderId: null, draft, saved: null, ...extra });

export function App() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => loadLocal<string | null>('mailman.env', null));
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('collections');
  const [tabs, setTabs] = useState<Tab[]>(() => loadLocal<PersistedTabs>('mailman.tabs', { tabs: [], activeTabId: null }).tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => loadLocal<PersistedTabs>('mailman.tabs', { tabs: [], activeTabId: null }).activeTabId);
  const [results, setResults] = useState<Record<string, SendResult>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceLabel, setWorkspaceLabel] = useState<string>('');

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  // ---- data loading ----------------------------------------------------------
  const showToast = useCallback((m: string) => { setToast(m); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const refreshCollections = useCallback(async () => setCollections(await api.collections.list()), []);
  const refreshEnvironments = useCallback(async () => setEnvironments(await api.environments.list()), []);
  const refreshHistory = useCallback(async () => setHistory(await api.history.list(200)), []);

  const run = useCallback(async (fn: () => Promise<unknown>, okMessage?: string) => {
    try { await fn(); if (okMessage) showToast(okMessage); return true; } catch (e) { showToast(`Error: ${(e as Error).message}`); return false; }
  }, [showToast]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([refreshCollections(), refreshEnvironments(), refreshHistory()]);
        setLoadError(null);
      } catch (e) { setLoadError((e as Error).message); }
    })();
    desktop?.getSettings().then((s) => setWorkspaceLabel(s.mode === 'remote' ? `Team · ${s.serverUrl.replace(/^https?:\/\//, '')}` : 'Local workspace'));
  }, [refreshCollections, refreshEnvironments, refreshHistory]);

  // Poll for team changes made by other people (cheap, and keeps the shared tree in sync).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') { refreshCollections().catch(() => {}); refreshEnvironments().catch(() => {}); } }, 15_000);
    return () => clearInterval(t);
  }, [refreshCollections, refreshEnvironments]);

  // persist tabs + env
  useEffect(() => { saveLocal('mailman.tabs', { tabs, activeTabId } satisfies PersistedTabs); }, [tabs, activeTabId]);
  useEffect(() => { saveLocal('mailman.env', activeEnvId); }, [activeEnvId]);
  useEffect(() => { if (activeEnvId && environments.length && !environments.some((e) => e.id === activeEnvId)) setActiveEnvId(null); }, [environments, activeEnvId]);

  // ---- tab helpers -----------------------------------------------------------
  const updateTab = useCallback((id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }, []);

  const openTab = useCallback((tab: Tab) => { setTabs((ts) => [...ts, tab]); setActiveTabId(tab.id); }, []);

  const openRequest = useCallback((r: SavedRequest) => {
    const existing = tabs.find((t) => t.requestId === r.id);
    if (existing) { setActiveTabId(existing.id); return; }
    openTab(newTab(draftFromSaved(r), { requestId: r.id, collectionId: r.collectionId, folderId: r.folderId, saved: draftFromSaved(r) }));
  }, [tabs, openTab]);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null);
      return next;
    });
    setResults((r) => { const { [id]: _drop, ...rest } = r; return rest; });
  }, [activeTabId]);

  const isDirty = (t: Tab) => t.saved === null || JSON.stringify(t.saved) !== JSON.stringify(t.draft);

  // keep open tabs in sync with tree changes (renames / deletions from other people or the sidebar)
  useEffect(() => {
    setTabs((ts) => ts.map((t) => {
      if (!t.requestId) return t;
      const saved = collections.flatMap((c) => c.requests).find((r) => r.id === t.requestId);
      if (!saved) return { ...t, requestId: null, saved: null }; // deleted remotely: keep as an unsaved draft
      const savedDraft = draftFromSaved(saved);
      if (t.saved && JSON.stringify(t.saved) === JSON.stringify(savedDraft)) return t;
      // remote changed: adopt it unless the user has local edits
      const dirty = t.saved === null || JSON.stringify(t.saved) !== JSON.stringify(t.draft);
      return { ...t, saved: savedDraft, draft: dirty ? t.draft : savedDraft, collectionId: saved.collectionId, folderId: saved.folderId };
    }));
  }, [collections]);

  // ---- send / save -----------------------------------------------------------
  const send = useCallback(async (tab: Tab) => {
    if (!tab.draft.url.trim() || sending[tab.id]) return;
    setSending((s) => ({ ...s, [tab.id]: true }));
    try {
      const res = await api.send({ ...tab.draft, ...(tab.requestId ? { id: tab.requestId } : {}) }, activeEnvId);
      setResults((r) => ({ ...r, [tab.id]: res }));
      refreshHistory().catch(() => {});
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`);
    } finally {
      setSending((s) => ({ ...s, [tab.id]: false }));
    }
  }, [activeEnvId, sending, refreshHistory, showToast]);

  const persistTab = useCallback(async (tab: Tab, target: SaveTarget) => {
    const draft = { ...tab.draft, name: target.name };
    const ok = await run(async () => {
      const saved = tab.requestId
        ? await api.requests.update(tab.requestId, { ...draft, collectionId: target.collectionId, folderId: target.folderId })
        : await api.requests.create({ ...draft, collectionId: target.collectionId, folderId: target.folderId });
      updateTab(tab.id, { requestId: saved.id, collectionId: saved.collectionId, folderId: saved.folderId, draft: draftFromSaved(saved), saved: draftFromSaved(saved) });
      await refreshCollections();
    }, 'Saved');
    if (ok) setDialog(null);
  }, [run, updateTab, refreshCollections]);

  const save = useCallback((tab: Tab) => {
    if (tab.requestId && tab.collectionId) persistTab(tab, { name: tab.draft.name, collectionId: tab.collectionId, folderId: tab.folderId });
    else setDialog({ kind: 'save', tabId: tab.id });
  }, [persistTab]);

  const copyCurl = useCallback(async (tab: Tab) => {
    try {
      const { curl } = await api.curl(tab.draft, activeEnvId);
      showToast((await copyText(curl)) ? 'cURL copied to clipboard' : 'Copy failed');
    } catch (e) { showToast(`Error: ${(e as Error).message}`); }
  }, [activeEnvId, showToast]);

  // keyboard shortcuts
  const activeRef = useRef<Tab | null>(activeTab);
  activeRef.current = activeTab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter' && activeRef.current) { e.preventDefault(); send(activeRef.current); }
      if (e.key.toLowerCase() === 's' && activeRef.current) { e.preventDefault(); save(activeRef.current); }
      if (e.key.toLowerCase() === 'w' && activeRef.current && !e.shiftKey) { e.preventDefault(); closeTab(activeRef.current.id); }
      if (e.key.toLowerCase() === 't' && !e.shiftKey) { e.preventDefault(); openTab(newTab()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, save, closeTab, openTab]);

  // ---- sidebar actions -------------------------------------------------------
  const prompt = (title: string, label: string, initial: string, onSubmit: (v: string) => void, submitLabel?: string) =>
    setDialog({ kind: 'prompt', title, label, initial, submitLabel, onSubmit });
  const confirm = (title: string, message: string, onConfirm: () => void) => setDialog({ kind: 'confirm', title, message, onConfirm });
  const download = (url: string) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };

  const actions: SidebarActions = useMemo(() => ({
    createCollection: () => prompt('New collection', 'Name', '', async (name) => { if (await run(() => api.collections.create(name).then(refreshCollections), 'Collection created')) setDialog(null); }, 'Create'),
    renameCollection: (c) => prompt('Rename collection', 'Name', c.name, async (name) => { if (await run(() => api.collections.update(c.id, { name }).then(refreshCollections))) setDialog(null); }, 'Rename'),
    deleteCollection: (c) => confirm('Delete collection', `Delete "${c.name}" and its ${c.requests.length} request(s)? Everyone on the team loses it.`, async () => { if (await run(() => api.collections.remove(c.id).then(refreshCollections), 'Collection deleted')) setDialog(null); }),
    exportCollection: (c) => download(api.collections.exportUrl(c.id)),
    createFolder: (collectionId, parentId) => prompt('New folder', 'Name', '', async (name) => { if (await run(() => api.folders.create(collectionId, name, parentId).then(refreshCollections))) setDialog(null); }, 'Create'),
    renameFolder: (f: Folder) => prompt('Rename folder', 'Name', f.name, async (name) => { if (await run(() => api.folders.update(f.id, { name }).then(refreshCollections))) setDialog(null); }, 'Rename'),
    deleteFolder: (f) => confirm('Delete folder', `Delete "${f.name}" and everything inside it?`, async () => { if (await run(() => api.folders.remove(f.id).then(refreshCollections), 'Folder deleted')) setDialog(null); }),
    newRequest: (collectionId, folderId) => openTab(newTab(emptyDraft(), { collectionId, folderId })),
    renameRequest: (r) => prompt('Rename request', 'Name', r.name, async (name) => { if (await run(() => api.requests.update(r.id, { name }).then(refreshCollections))) setDialog(null); }, 'Rename'),
    duplicateRequest: (r) => run(() => api.requests.create({ ...draftFromSaved(r), name: `${r.name} (copy)`, collectionId: r.collectionId, folderId: r.folderId }).then(refreshCollections), 'Duplicated'),
    deleteRequest: (r) => confirm('Delete request', `Delete "${r.name}"?`, async () => { if (await run(() => api.requests.remove(r.id).then(refreshCollections), 'Request deleted')) setDialog(null); }),
    createEnvironment: () => setDialog({ kind: 'environment', environment: null }),
    editEnvironment: (e) => setDialog({ kind: 'environment', environment: e }),
    duplicateEnvironment: (e) => run(() => api.environments.create(`${e.name} (copy)`, e.variables).then(refreshEnvironments), 'Duplicated'),
    deleteEnvironment: (e) => confirm('Delete environment', `Delete "${e.name}"?`, async () => { if (await run(() => api.environments.remove(e.id).then(refreshEnvironments), 'Environment deleted')) setDialog(null); }),
    exportEnvironment: (e) => download(api.environments.exportUrl(e.id)),
    openHistory: (h) => {
      const d: RequestDraft = { ...emptyDraft(), ...h.request, name: h.request.name || `${h.request.method ?? 'GET'} ${h.request.url ?? ''}`.trim() } as RequestDraft;
      openTab(newTab(d));
      if (h.request.environmentId && environments.some((e) => e.id === h.request.environmentId)) setActiveEnvId(h.request.environmentId);
    },
    deleteHistory: (h) => run(() => api.history.remove(h.id).then(refreshHistory)),
    clearHistory: () => confirm('Clear history', 'Remove all history entries for the whole team?', async () => { if (await run(() => api.history.clear().then(refreshHistory))) setDialog(null); }),
    importFile: () => setDialog({ kind: 'import' }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [run, refreshCollections, refreshEnvironments, refreshHistory, openTab, environments]);

  // ---- render -----------------------------------------------------------------
  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">✉</span> mailman</div>
        {desktop && (
          <button className="workspace" onClick={() => setDialog({ kind: 'workspace' })} title="Switch between your local workspace and the team server">
            <span className={`dot ${workspaceLabel.startsWith('Team') ? 'team' : ''}`} /> {workspaceLabel || 'Workspace'}
          </button>
        )}
        <div className="spacer" />
        <label className="env-picker" title="Active environment">
          <span>Env</span>
          <select value={activeEnvId ?? ''} onChange={(e) => setActiveEnvId(e.target.value || null)}>
            <option value="">No environment</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {activeEnv && <button className="icon" title="Edit environment" onClick={() => setDialog({ kind: 'environment', environment: activeEnv })}>✎</button>}
        </label>
      </header>

      {loadError && (
        <div className="banner error">
          Could not reach the mailman server: {loadError}.{' '}
          {desktop ? <button className="link" onClick={() => setDialog({ kind: 'workspace' })}>Check workspace settings</button> : 'Is it running?'}
        </div>
      )}

      <div className="layout">
        <Sidebar
          tab={sidebarTab}
          onTab={setSidebarTab}
          collections={collections}
          environments={environments}
          activeEnvironmentId={activeEnvId}
          history={history}
          activeRequestId={activeTab?.requestId ?? null}
          onOpenRequest={openRequest}
          actions={actions}
        />

        <main className="main">
          <div className="tabbar">
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${t.id === activeTab?.id ? 'active' : ''}`} onClick={() => setActiveTabId(t.id)} onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}>
                <span className={`method m-${t.draft.method}`}>{shortMethod(t.draft.method)}</span>
                <span className="tab-name">{t.draft.name || t.draft.url || 'Untitled'}</span>
                {isDirty(t) && <span className="dirty-dot" title="Unsaved changes">•</span>}
                <button className="icon close" title="Close (Ctrl+W)" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>×</button>
              </div>
            ))}
            <button className="icon new-tab" title="New request (Ctrl+T)" onClick={() => openTab(newTab())}>+</button>
          </div>

          {activeTab ? (
            <div className="workbench" key={activeTab.id}>
              <div className="request-name">
                <input value={activeTab.draft.name} onChange={(e) => updateTab(activeTab.id, { draft: { ...activeTab.draft, name: e.target.value } })} placeholder="Request name" spellCheck={false} />
                {activeTab.collectionId && <span className="crumb">{collections.find((c) => c.id === activeTab.collectionId)?.name ?? ''}{activeTab.folderId ? ` / ${collections.flatMap((c) => c.folders).find((f) => f.id === activeTab.folderId)?.name ?? ''}` : ''}</span>}
                {!activeTab.requestId && <span className="crumb unsaved">unsaved</span>}
              </div>
              <RequestEditor
                draft={activeTab.draft}
                onChange={(draft) => updateTab(activeTab.id, { draft })}
                onSend={() => send(activeTab)}
                onSave={() => save(activeTab)}
                onCopyCurl={() => copyCurl(activeTab)}
                sending={!!sending[activeTab.id]}
                dirty={isDirty(activeTab)}
              />
              <ResponseViewer result={results[activeTab.id] ?? null} sending={!!sending[activeTab.id]} onToast={showToast} />
            </div>
          ) : (
            <div className="welcome">
              <h2>Welcome to mailman</h2>
              <p>Pick a request from a collection on the left, or start a new one.</p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => openTab(newTab())}>New request</button>
                <button onClick={() => setDialog({ kind: 'import' })}>Import from Postman</button>
              </div>
              <ul className="shortcuts">
                <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> send</li>
                <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save</li>
                <li><kbd>Ctrl</kbd>+<kbd>T</kbd> new tab</li>
                <li><kbd>Ctrl</kbd>+<kbd>W</kbd> close tab</li>
              </ul>
            </div>
          )}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {dialog?.kind === 'prompt' && <PromptDialog title={dialog.title} label={dialog.label} initial={dialog.initial} submitLabel={dialog.submitLabel} onSubmit={dialog.onSubmit} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'confirm' && <ConfirmDialog title={dialog.title} message={dialog.message} onConfirm={dialog.onConfirm} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'save' && (() => {
        const tab = tabs.find((t) => t.id === dialog.tabId);
        if (!tab) return null;
        return (
          <SaveDialog
            collections={collections}
            initialName={tab.draft.name === 'Untitled request' && tab.draft.url ? tab.draft.url.replace(/^https?:\/\//, '').slice(0, 60) : tab.draft.name}
            initialCollectionId={tab.collectionId}
            initialFolderId={tab.folderId}
            onSubmit={(target) => persistTab(tab, target)}
            onClose={() => setDialog(null)}
            onCreateCollection={async (name) => { const c = await api.collections.create(name); await refreshCollections(); return c; }}
          />
        );
      })()}
      {dialog?.kind === 'environment' && (
        <EnvironmentEditor
          environment={dialog.environment}
          onClose={() => setDialog(null)}
          onSave={async (name, variables) => {
            const ok = await run(async () => {
              if (dialog.environment) await api.environments.update(dialog.environment.id, { name, variables });
              else { const e = await api.environments.create(name, variables); setActiveEnvId(e.id); }
              await refreshEnvironments();
            }, 'Environment saved');
            if (ok) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImport={async (json) => {
            const r = await api.import(json);
            await Promise.all([refreshCollections(), refreshEnvironments()]);
            showToast(r.type === 'collection' ? 'Collection imported' : 'Environment imported');
            setSidebarTab(r.type === 'collection' ? 'collections' : 'environments');
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'workspace' && <WorkspaceDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
