<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Collection, Environment, Folder, HistoryEntry, SavedRequest } from '../types';
import MenuDropdown from './MenuDropdown.vue';
import { loadLocal, saveLocal, shortMethod, statusClass, timeAgo } from '../lib/util';

export type SidebarTab = 'collections' | 'environments' | 'history';

export interface SidebarActions {
  createCollection: () => void;
  renameCollection: (c: Collection) => void;
  deleteCollection: (c: Collection) => void;
  exportCollection: (c: Collection) => void;
  syncCollection: (c: Collection) => void;
  unlinkCollection: (c: Collection) => void;
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

const props = defineProps<{
  tab: SidebarTab;
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  activeRequestId: string | null;
  actions: SidebarActions;
}>();
const emit = defineEmits<{ 'update:tab': [t: SidebarTab]; openRequest: [r: SavedRequest] }>();

const filterText = ref('');
const filter = computed(() => filterText.value.trim().toLowerCase());

// ---- collections tree ------------------------------------------------------
const collapsed = ref<Record<string, boolean>>(loadLocal('mailman.collapsed', {}));
const toggle = (id: string) => { collapsed.value[id] = !collapsed.value[id]; saveLocal('mailman.collapsed', collapsed.value); };
const isOpen = (id: string) => (filter.value ? true : !collapsed.value[id]);
const matches = (r: SavedRequest) => !filter.value || r.name.toLowerCase().includes(filter.value) || r.url.toLowerCase().includes(filter.value);
const folderHasMatches = (c: Collection, f: Folder): boolean =>
  c.requests.some((r) => r.folderId === f.id && matches(r)) || c.folders.filter((x) => x.parentId === f.id).some((sf) => folderHasMatches(c, sf));
const folderVisible = (c: Collection, f: Folder) => !filter.value || f.name.toLowerCase().includes(filter.value) || folderHasMatches(c, f);
const collectionVisible = (c: Collection) => !filter.value || c.name.toLowerCase().includes(filter.value) || c.requests.some(matches);

interface Row { kind: 'folder' | 'request'; depth: number; folder?: Folder; request?: SavedRequest }
/** Flatten a collection's visible tree into rows so the template stays simple. */
const rowsFor = (c: Collection): Row[] => {
  const out: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of c.folders.filter((x) => x.parentId === parentId)) {
      if (!folderVisible(c, f)) continue;
      out.push({ kind: 'folder', depth, folder: f });
      if (isOpen(f.id)) walk(f.id, depth + 1);
    }
    for (const r of c.requests.filter((x) => x.folderId === parentId && matches(x))) out.push({ kind: 'request', depth, request: r });
  };
  walk(null, 1);
  return out;
};

const collectionMenu = (c: Collection) => [
  ...(c.sourceUrl ? [{ label: 'Sync now', onClick: () => props.actions.syncCollection(c) }] : [{ label: 'New request', onClick: () => props.actions.newRequest(c.id, null) }, { label: 'New folder', onClick: () => props.actions.createFolder(c.id, null) }]),
  { label: 'Rename', onClick: () => props.actions.renameCollection(c) },
  { label: 'Export (Postman v2.1)', onClick: () => props.actions.exportCollection(c) },
  ...(c.sourceUrl ? [{ label: 'Unlink from spec (keep requests)', onClick: () => props.actions.unlinkCollection(c) }] : []),
  { label: '', separator: true },
  { label: 'Delete collection', onClick: () => props.actions.deleteCollection(c), danger: true },
];
const folderMenu = (c: Collection, f: Folder) => [
  { label: 'New request', onClick: () => props.actions.newRequest(c.id, f.id) },
  { label: 'New folder', onClick: () => props.actions.createFolder(c.id, f.id) },
  { label: 'Rename', onClick: () => props.actions.renameFolder(f) },
  { label: '', separator: true },
  { label: 'Delete folder', onClick: () => props.actions.deleteFolder(f), danger: true },
];
const requestMenu = (r: SavedRequest) => [
  { label: 'Rename', onClick: () => props.actions.renameRequest(r) },
  { label: 'Duplicate', onClick: () => props.actions.duplicateRequest(r) },
  { label: '', separator: true },
  { label: 'Delete request', onClick: () => props.actions.deleteRequest(r), danger: true },
];
const envMenu = (e: Environment) => [
  { label: 'Edit', onClick: () => props.actions.editEnvironment(e) },
  { label: 'Duplicate', onClick: () => props.actions.duplicateEnvironment(e) },
  { label: 'Export (Postman)', onClick: () => props.actions.exportEnvironment(e) },
  { label: '', separator: true },
  { label: 'Delete environment', onClick: () => props.actions.deleteEnvironment(e), danger: true },
];

const envList = computed(() => props.environments.filter((e) => !filter.value || e.name.toLowerCase().includes(filter.value)));
const historyList = computed(() => props.history.filter((h) => !filter.value || (h.request.url ?? '').toLowerCase().includes(filter.value) || (h.request.name ?? '').toLowerCase().includes(filter.value)));
const syncTitle = (c: Collection) => c.sourceError ? `Sync failed: ${c.sourceError}` : `Synced from ${c.sourceUrl}${c.sourceSyncedAt ? ' · ' + timeAgo(c.sourceSyncedAt) : ''}`;
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-tabs">
      <button :class="{ active: props.tab === 'collections' }" @click="emit('update:tab', 'collections')">Collections</button>
      <button :class="{ active: props.tab === 'environments' }" @click="emit('update:tab', 'environments')">Environments</button>
      <button :class="{ active: props.tab === 'history' }" @click="emit('update:tab', 'history')">History</button>
    </div>
    <div class="sidebar-toolbar">
      <input v-model="filterText" class="filter" placeholder="Filter…" />
      <template v-if="props.tab === 'collections'">
        <button class="small" title="New collection" @click="props.actions.createCollection()">+ New</button>
        <button class="small" title="Import a Postman collection, environment, or link an OpenAPI spec" @click="props.actions.importFile()">Import</button>
      </template>
      <button v-if="props.tab === 'environments'" class="small" @click="props.actions.createEnvironment()">+ New</button>
      <button v-if="props.tab === 'history' && props.history.length" class="small" @click="props.actions.clearHistory()">Clear</button>
    </div>

    <div class="sidebar-body">
      <!-- collections -->
      <template v-if="props.tab === 'collections'">
        <div v-if="props.collections.length === 0" class="empty">
          <p>No collections yet.</p>
          <p><button class="link" @click="props.actions.createCollection()">Create one</button> or <button class="link" @click="props.actions.importFile()">import from Postman</button>.</p>
        </div>
        <div v-else class="tree">
          <template v-for="c in props.collections" :key="c.id">
            <div v-if="collectionVisible(c)" class="collection">
              <div class="tree-row collection-row" @click="toggle(c.id)">
                <span class="chev" :class="{ open: isOpen(c.id) }">▸</span>
                <span class="name">{{ c.name }}</span>
                <span v-if="c.sourceUrl" class="sync" :class="{ err: !!c.sourceError }" :title="syncTitle(c)">⟳</span>
                <span class="count">{{ c.requests.length }}</span>
                <MenuDropdown :items="collectionMenu(c)" />
              </div>
              <div v-if="isOpen(c.id)">
                <template v-for="row in rowsFor(c)" :key="row.kind === 'folder' ? 'f' + row.folder!.id : 'r' + row.request!.id">
                  <div v-if="row.kind === 'folder'" class="tree-row folder" :style="{ paddingLeft: 10 + row.depth * 14 + 'px' }" @click="toggle(row.folder!.id)">
                    <span class="chev" :class="{ open: isOpen(row.folder!.id) }">▸</span>
                    <span class="name">{{ row.folder!.name }}</span>
                    <MenuDropdown :items="folderMenu(c, row.folder!)" />
                  </div>
                  <div v-else class="tree-row request" :class="{ active: row.request!.id === props.activeRequestId }" :style="{ paddingLeft: 10 + row.depth * 14 + 'px' }" :title="row.request!.url" @click="emit('openRequest', row.request!)">
                    <span class="method" :class="'m-' + row.request!.method">{{ shortMethod(row.request!.method) }}</span>
                    <span class="name">{{ row.request!.name }}</span>
                    <MenuDropdown :items="requestMenu(row.request!)" />
                  </div>
                </template>
                <div v-if="c.requests.length === 0 && c.folders.length === 0" class="tree-hint">
                  <template v-if="c.sourceUrl">Nothing synced yet{{ c.sourceError ? ': ' + c.sourceError : '' }}.</template>
                  <template v-else>Empty. <button class="link" @click="props.actions.newRequest(c.id, null)">Add a request</button></template>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- environments -->
      <template v-else-if="props.tab === 'environments'">
        <div v-if="props.environments.length === 0" class="empty">
          <p>No environments yet.</p>
          <p>Environments hold variables like <code v-text="'{{baseUrl}}'"></code> that you can use anywhere in a request.</p>
          <p><button class="link" @click="props.actions.createEnvironment()">Create one</button></p>
        </div>
        <div v-else class="tree">
          <div v-for="e in envList" :key="e.id" class="tree-row env" :class="{ active: e.id === props.activeEnvironmentId }" @click="props.actions.editEnvironment(e)">
            <span class="dot" />
            <span class="name">{{ e.name }}</span>
            <span class="count">{{ e.variables.length }}</span>
            <MenuDropdown :items="envMenu(e)" />
          </div>
        </div>
      </template>

      <!-- history -->
      <template v-else>
        <div v-if="props.history.length === 0" class="empty"><p>Requests you send will show up here.</p></div>
        <div v-else class="tree">
          <div v-for="h in historyList" :key="h.id" class="tree-row history" :title="h.request.url" @click="props.actions.openHistory(h)">
            <span class="method" :class="'m-' + h.request.method">{{ shortMethod(h.request.method ?? 'GET') }}</span>
            <span class="name">{{ h.request.url || '(no url)' }}</span>
            <span class="status" :class="h.response.ok === false ? 'err' : statusClass(h.response.status)">{{ h.response.ok === false ? 'ERR' : h.response.status }}</span>
            <span class="count">{{ timeAgo(h.createdAt) }}</span>
            <MenuDropdown :items="[{ label: 'Remove', onClick: () => props.actions.deleteHistory(h), danger: true }]" />
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>
