<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { api } from './lib/api';
import { desktop } from './lib/desktop';
import { copyText, loadLocal, saveLocal, shortMethod, uid } from './lib/util';
import { draftFromSaved, emptyDraft, type Collection, type Environment, type HistoryEntry, type RequestDraft, type SavedRequest, type SendResult, type Variable } from './types';
import SidebarPanel, { type SidebarActions, type SidebarTab } from './components/SidebarPanel.vue';
import RequestEditor from './components/RequestEditor.vue';
import ResponseViewer from './components/ResponseViewer.vue';
import PromptDialog from './components/PromptDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import SaveDialog, { type SaveTarget } from './components/SaveDialog.vue';
import EnvironmentEditor from './components/EnvironmentEditor.vue';
import ImportDialog from './components/ImportDialog.vue';
import WorkspaceDialog from './components/WorkspaceDialog.vue';

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

// ---- state ------------------------------------------------------------------
const persisted = loadLocal<PersistedTabs>('mailman.tabs', { tabs: [], activeTabId: null });
const collections = ref<Collection[]>([]);
const environments = ref<Environment[]>([]);
const history = ref<HistoryEntry[]>([]);
const activeEnvId = ref<string | null>(loadLocal<string | null>('mailman.env', null));
const sidebarTab = ref<SidebarTab>('collections');
const tabs = ref<Tab[]>(persisted.tabs);
const activeTabId = ref<string | null>(persisted.activeTabId);
const results = reactive<Record<string, SendResult>>({});
const sending = reactive<Record<string, boolean>>({});
const dialog = ref<Dialog | null>(null);
const toast = ref<string | null>(null);
const loadError = ref<string | null>(null);
const workspaceLabel = ref('');

const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0] ?? null);
const activeEnv = computed(() => environments.value.find((e) => e.id === activeEnvId.value) ?? null);
const isDirty = (t: Tab) => t.saved === null || JSON.stringify(t.saved) !== JSON.stringify(t.draft);
const isDesktop = !!desktop;

// ---- toasts / errors --------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const showToast = (m: string) => { toast.value = m; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = null; }, 2500); };
const run = async (fn: () => Promise<unknown>, okMessage?: string) => {
  try { await fn(); if (okMessage) showToast(okMessage); return true; } catch (e) { showToast(`Error: ${(e as Error).message}`); return false; }
};

// ---- data loading -----------------------------------------------------------
const refreshCollections = async () => { collections.value = await api.collections.list(); };
const refreshEnvironments = async () => { environments.value = await api.environments.list(); };
const refreshHistory = async () => { history.value = await api.history.list(200); };

let poll: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  try {
    await Promise.all([refreshCollections(), refreshEnvironments(), refreshHistory()]);
    loadError.value = null;
  } catch (e) { loadError.value = (e as Error).message; }
  desktop?.getSettings().then((s) => { workspaceLabel.value = s.mode === 'remote' ? `Team · ${s.serverUrl.replace(/^https?:\/\//, '')}` : 'Local workspace'; });
  // Keep the shared tree in sync with teammates' changes (and with OpenAPI syncs).
  poll = setInterval(() => { if (document.visibilityState === 'visible') { refreshCollections().catch(() => {}); refreshEnvironments().catch(() => {}); } }, 15_000);
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => { clearInterval(poll); window.removeEventListener('keydown', onKey); });

watch([tabs, activeTabId], () => saveLocal('mailman.tabs', { tabs: tabs.value, activeTabId: activeTabId.value } satisfies PersistedTabs), { deep: true });
watch(activeEnvId, (v) => saveLocal('mailman.env', v));
watch(environments, (list) => { if (activeEnvId.value && list.length && !list.some((e) => e.id === activeEnvId.value)) activeEnvId.value = null; });

// keep open tabs in sync with tree changes (renames / deletions from other people or the sidebar)
watch(collections, (cols) => {
  const all = cols.flatMap((c) => c.requests);
  for (const t of tabs.value) {
    if (!t.requestId) continue;
    const saved = all.find((r) => r.id === t.requestId);
    if (!saved) { t.requestId = null; t.saved = null; continue; } // deleted remotely: keep as an unsaved draft
    const savedDraft = draftFromSaved(saved);
    if (t.saved && JSON.stringify(t.saved) === JSON.stringify(savedDraft)) continue;
    const dirty = isDirty(t);
    t.saved = savedDraft;
    if (!dirty) t.draft = savedDraft;
    t.collectionId = saved.collectionId;
    t.folderId = saved.folderId;
  }
});

// ---- tabs -------------------------------------------------------------------
const openTab = (tab: Tab) => { tabs.value.push(tab); activeTabId.value = tab.id; };
const openRequest = (r: SavedRequest) => {
  const existing = tabs.value.find((t) => t.requestId === r.id);
  if (existing) { activeTabId.value = existing.id; return; }
  openTab(newTab(draftFromSaved(r), { requestId: r.id, collectionId: r.collectionId, folderId: r.folderId, saved: draftFromSaved(r) }));
};
const closeTab = (id: string) => {
  const idx = tabs.value.findIndex((t) => t.id === id);
  tabs.value = tabs.value.filter((t) => t.id !== id);
  if (activeTabId.value === id) activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? tabs.value[0]?.id ?? null;
  delete results[id];
};
const setDraft = (tab: Tab, draft: RequestDraft) => { tab.draft = draft; };

// ---- send / save ------------------------------------------------------------
const send = async (tab: Tab) => {
  if (!tab.draft.url.trim() || sending[tab.id]) return;
  sending[tab.id] = true;
  try {
    results[tab.id] = await api.send({ ...tab.draft, ...(tab.requestId ? { id: tab.requestId } : {}) }, activeEnvId.value);
    refreshHistory().catch(() => {});
  } catch (e) { showToast(`Error: ${(e as Error).message}`); } finally { sending[tab.id] = false; }
};

const persistTab = async (tab: Tab, target: SaveTarget) => {
  const draft = { ...tab.draft, name: target.name };
  const ok = await run(async () => {
    const saved = tab.requestId
      ? await api.requests.update(tab.requestId, { ...draft, collectionId: target.collectionId, folderId: target.folderId })
      : await api.requests.create({ ...draft, collectionId: target.collectionId, folderId: target.folderId });
    Object.assign(tab, { requestId: saved.id, collectionId: saved.collectionId, folderId: saved.folderId, draft: draftFromSaved(saved), saved: draftFromSaved(saved) });
    await refreshCollections();
  }, 'Saved');
  if (ok) dialog.value = null;
};
const save = (tab: Tab) => {
  if (tab.requestId && tab.collectionId) persistTab(tab, { name: tab.draft.name, collectionId: tab.collectionId, folderId: tab.folderId });
  else dialog.value = { kind: 'save', tabId: tab.id };
};
const copyCurl = async (tab: Tab) => {
  try {
    const { curl } = await api.curl(tab.draft, activeEnvId.value);
    showToast((await copyText(curl)) ? 'cURL copied to clipboard' : 'Copy failed');
  } catch (e) { showToast(`Error: ${(e as Error).message}`); }
};

const onKey = (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = activeTab.value;
  if (e.key === 'Enter' && t) { e.preventDefault(); send(t); }
  else if (e.key.toLowerCase() === 's' && t) { e.preventDefault(); save(t); }
  else if (e.key.toLowerCase() === 'w' && t && !e.shiftKey) { e.preventDefault(); closeTab(t.id); }
  else if (e.key.toLowerCase() === 't' && !e.shiftKey) { e.preventDefault(); openTab(newTab()); }
};

// ---- sidebar actions --------------------------------------------------------
const prompt = (title: string, label: string, initial: string, onSubmit: (v: string) => void, submitLabel?: string) => { dialog.value = { kind: 'prompt', title, label, initial, submitLabel, onSubmit }; };
const confirm = (title: string, message: string, onConfirm: () => void) => { dialog.value = { kind: 'confirm', title, message, onConfirm }; };
const download = (url: string) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
const closeIf = async (p: Promise<boolean>) => { if (await p) dialog.value = null; };

const actions: SidebarActions = {
  createCollection: () => prompt('New collection', 'Name', '', (name) => closeIf(run(() => api.collections.create(name).then(refreshCollections), 'Collection created')), 'Create'),
  renameCollection: (c) => prompt('Rename collection', 'Name', c.name, (name) => closeIf(run(() => api.collections.update(c.id, { name }).then(refreshCollections))), 'Rename'),
  deleteCollection: (c) => confirm('Delete collection', `Delete "${c.name}" and its ${c.requests.length} request(s)? Everyone on the team loses it.`, () => closeIf(run(() => api.collections.remove(c.id).then(refreshCollections), 'Collection deleted'))),
  exportCollection: (c) => download(api.collections.exportUrl(c.id)),
  syncCollection: (c) => run(async () => { const r = await api.collections.sync(c.id); await refreshCollections(); showToast(`Synced ${r.synced} endpoint(s) from spec`); }),
  unlinkCollection: (c) => confirm('Unlink from spec', `Stop syncing "${c.name}" from ${c.sourceUrl}? The requests stay and become editable.`, () => closeIf(run(() => api.collections.unlink(c.id).then(refreshCollections), 'Unlinked'))),
  createFolder: (collectionId, parentId) => prompt('New folder', 'Name', '', (name) => closeIf(run(() => api.folders.create(collectionId, name, parentId).then(refreshCollections))), 'Create'),
  renameFolder: (f) => prompt('Rename folder', 'Name', f.name, (name) => closeIf(run(() => api.folders.update(f.id, { name }).then(refreshCollections))), 'Rename'),
  deleteFolder: (f) => confirm('Delete folder', `Delete "${f.name}" and everything inside it?`, () => closeIf(run(() => api.folders.remove(f.id).then(refreshCollections), 'Folder deleted'))),
  newRequest: (collectionId, folderId) => openTab(newTab(emptyDraft(), { collectionId, folderId })),
  renameRequest: (r) => prompt('Rename request', 'Name', r.name, (name) => closeIf(run(() => api.requests.update(r.id, { name }).then(refreshCollections))), 'Rename'),
  duplicateRequest: (r) => { run(() => api.requests.create({ ...draftFromSaved(r), name: `${r.name} (copy)`, collectionId: r.collectionId, folderId: r.folderId }).then(refreshCollections), 'Duplicated'); },
  deleteRequest: (r) => confirm('Delete request', `Delete "${r.name}"?`, () => closeIf(run(() => api.requests.remove(r.id).then(refreshCollections), 'Request deleted'))),
  createEnvironment: () => { dialog.value = { kind: 'environment', environment: null }; },
  editEnvironment: (e) => { dialog.value = { kind: 'environment', environment: e }; },
  duplicateEnvironment: (e) => { run(() => api.environments.create(`${e.name} (copy)`, e.variables).then(refreshEnvironments), 'Duplicated'); },
  deleteEnvironment: (e) => confirm('Delete environment', `Delete "${e.name}"?`, () => closeIf(run(() => api.environments.remove(e.id).then(refreshEnvironments), 'Environment deleted'))),
  exportEnvironment: (e) => download(api.environments.exportUrl(e.id)),
  openHistory: (h) => {
    const d = { ...emptyDraft(), ...h.request, name: h.request.name || `${h.request.method ?? 'GET'} ${h.request.url ?? ''}`.trim() } as RequestDraft;
    openTab(newTab(d));
    if (h.request.environmentId && environments.value.some((e) => e.id === h.request.environmentId)) activeEnvId.value = h.request.environmentId;
  },
  deleteHistory: (h) => { run(() => api.history.remove(h.id).then(refreshHistory)); },
  clearHistory: () => confirm('Clear history', 'Remove all history entries for the whole team?', () => closeIf(run(() => api.history.clear().then(refreshHistory)))),
  importFile: () => { dialog.value = { kind: 'import' }; },
};

const saveEnvironment = async (name: string, variables: Variable[]) => {
  const d = dialog.value;
  if (d?.kind !== 'environment') return;
  const ok = await run(async () => {
    if (d.environment) await api.environments.update(d.environment.id, { name, variables });
    else { const e = await api.environments.create(name, variables); activeEnvId.value = e.id; }
    await refreshEnvironments();
  }, 'Environment saved');
  if (ok) dialog.value = null;
};
const importJson = async (json: unknown) => {
  const r = await api.import(json);
  await Promise.all([refreshCollections(), refreshEnvironments()]);
  showToast(r.type === 'collection' ? 'Collection imported' : 'Environment imported');
  sidebarTab.value = r.type === 'collection' ? 'collections' : 'environments';
  dialog.value = null;
};
const linkOpenApi = async (url: string, name: string) => {
  const c = await api.collections.linkOpenApi(url, name);
  await refreshCollections();
  showToast(`Linked "${c.name}" — ${c.requests?.length ?? 0} endpoint(s)`);
  sidebarTab.value = 'collections';
  dialog.value = null;
};
const saveDialogTab = computed(() => { const d = dialog.value; return d?.kind === 'save' ? tabs.value.find((t) => t.id === d.tabId) ?? null : null; });
const suggestedName = (t: Tab) => (t.draft.name === 'Untitled request' && t.draft.url ? t.draft.url.replace(/^https?:\/\//, '').slice(0, 60) : t.draft.name);
const crumb = (t: Tab) => {
  const c = collections.value.find((x) => x.id === t.collectionId);
  const f = t.folderId ? collections.value.flatMap((x) => x.folders).find((x) => x.id === t.folderId) : null;
  return c ? `${c.name}${f ? ` / ${f.name}` : ''}` : '';
};
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="logo">✉</span> mailman</div>
      <button v-if="isDesktop" class="workspace" title="Switch between your local workspace and the team server" @click="dialog = { kind: 'workspace' }">
        <span class="dot" :class="{ team: workspaceLabel.startsWith('Team') }" /> {{ workspaceLabel || 'Workspace' }}
      </button>
      <div class="spacer" />
      <label class="env-picker" title="Active environment">
        <span>Env</span>
        <select :value="activeEnvId ?? ''" @change="activeEnvId = ($event.target as HTMLSelectElement).value || null">
          <option value="">No environment</option>
          <option v-for="e in environments" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
        <button v-if="activeEnv" class="icon" title="Edit environment" @click="dialog = { kind: 'environment', environment: activeEnv }">✎</button>
      </label>
    </header>

    <div v-if="loadError" class="banner error">
      Could not reach the mailman server: {{ loadError }}.
      <button v-if="isDesktop" class="link" @click="dialog = { kind: 'workspace' }">Check workspace settings</button>
      <template v-else>Is it running?</template>
    </div>

    <div class="layout">
      <SidebarPanel
        v-model:tab="sidebarTab"
        :collections="collections"
        :environments="environments"
        :active-environment-id="activeEnvId"
        :history="history"
        :active-request-id="activeTab?.requestId ?? null"
        :actions="actions"
        @open-request="openRequest"
      />

      <main class="main">
        <div class="tabbar">
          <div v-for="t in tabs" :key="t.id" class="tab" :class="{ active: t.id === activeTab?.id }" @click="activeTabId = t.id" @auxclick.middle="closeTab(t.id)">
            <span class="method" :class="'m-' + t.draft.method">{{ shortMethod(t.draft.method) }}</span>
            <span class="tab-name">{{ t.draft.name || t.draft.url || 'Untitled' }}</span>
            <span v-if="isDirty(t)" class="dirty-dot" title="Unsaved changes">•</span>
            <button class="icon close" title="Close (Ctrl+W)" @click.stop="closeTab(t.id)">×</button>
          </div>
          <button class="icon new-tab" title="New request (Ctrl+T)" @click="openTab(newTab())">+</button>
        </div>

        <div v-if="activeTab" :key="activeTab.id" class="workbench">
          <div class="request-name">
            <input :value="activeTab.draft.name" placeholder="Request name" spellcheck="false" @input="setDraft(activeTab, { ...activeTab.draft, name: ($event.target as HTMLInputElement).value })" />
            <span v-if="activeTab.collectionId" class="crumb">{{ crumb(activeTab) }}</span>
            <span v-if="!activeTab.requestId" class="crumb unsaved">unsaved</span>
          </div>
          <RequestEditor
            :draft="activeTab.draft"
            :sending="!!sending[activeTab.id]"
            :dirty="isDirty(activeTab)"
            @update:draft="setDraft(activeTab, $event)"
            @send="send(activeTab)"
            @save="save(activeTab)"
            @copy-curl="copyCurl(activeTab)"
          />
          <ResponseViewer :result="results[activeTab.id] ?? null" :sending="!!sending[activeTab.id]" @toast="showToast" />
        </div>

        <div v-else class="welcome">
          <h2>Welcome to mailman</h2>
          <p>Pick a request from a collection on the left, or start a new one.</p>
          <div class="welcome-actions">
            <button class="primary" @click="openTab(newTab())">New request</button>
            <button @click="dialog = { kind: 'import' }">Import from Postman</button>
          </div>
          <ul class="shortcuts">
            <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> send</li>
            <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save</li>
            <li><kbd>Ctrl</kbd>+<kbd>T</kbd> new tab</li>
            <li><kbd>Ctrl</kbd>+<kbd>W</kbd> close tab</li>
          </ul>
        </div>
      </main>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <PromptDialog v-if="dialog?.kind === 'prompt'" :title="dialog.title" :label="dialog.label" :initial="dialog.initial" :submit-label="dialog.submitLabel" @submit="dialog.onSubmit($event)" @close="dialog = null" />
    <ConfirmDialog v-else-if="dialog?.kind === 'confirm'" :title="dialog.title" :message="dialog.message" @confirm="dialog.onConfirm()" @close="dialog = null" />
    <SaveDialog
      v-else-if="dialog?.kind === 'save' && saveDialogTab"
      :collections="collections"
      :initial-name="suggestedName(saveDialogTab)"
      :initial-collection-id="saveDialogTab.collectionId"
      :initial-folder-id="saveDialogTab.folderId"
      :create-collection="async (name: string) => { const c = await api.collections.create(name); await refreshCollections(); return c; }"
      @submit="persistTab(saveDialogTab!, $event)"
      @close="dialog = null"
    />
    <EnvironmentEditor v-else-if="dialog?.kind === 'environment'" :environment="dialog.environment" :save="saveEnvironment" @close="dialog = null" />
    <ImportDialog v-else-if="dialog?.kind === 'import'" :import-json="importJson" :link-open-api="linkOpenApi" @close="dialog = null" />
    <WorkspaceDialog v-else-if="dialog?.kind === 'workspace'" @close="dialog = null" />
  </div>
</template>
