<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Collection } from '../types';
import ModalShell from './ModalShell.vue';

export interface SaveTarget { name: string; collectionId: string; folderId: string | null }

const props = defineProps<{
  collections: Collection[];
  initialName: string;
  initialCollectionId?: string | null;
  initialFolderId?: string | null;
  createCollection: (name: string) => Promise<Collection>;
}>();
const emit = defineEmits<{ submit: [target: SaveTarget]; close: [] }>();

const name = ref(props.initialName);
const collectionId = ref(props.initialCollectionId ?? props.collections[0]?.id ?? '__new__');
const folderId = ref(props.initialFolderId ?? '');
const newCollection = ref('');
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);
onMounted(() => { input.value?.focus(); input.value?.select(); });

const creating = computed(() => props.collections.length === 0 || collectionId.value === '__new__');
const folderOptions = computed(() => {
  const c = props.collections.find((x) => x.id === collectionId.value);
  return c ? flattenFolders(c) : [];
});

function flattenFolders(c: Collection): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    for (const f of c.folders.filter((x) => x.parentId === parentId)) {
      out.push({ id: f.id, label: prefix + f.name });
      walk(f.id, prefix + f.name + ' / ');
    }
  };
  walk(null, '');
  return out;
}

const canSubmit = computed(() => !busy.value && !!name.value.trim() && (!creating.value || !!newCollection.value.trim()));

const submit = async () => {
  if (!canSubmit.value) return;
  let target = collectionId.value;
  if (creating.value) {
    busy.value = true;
    try { target = (await props.createCollection(newCollection.value.trim())).id; } finally { busy.value = false; }
  }
  emit('submit', { name: name.value.trim(), collectionId: target, folderId: creating.value ? null : folderId.value || null });
};
</script>

<template>
  <ModalShell title="Save request" @close="emit('close')">
    <form @submit.prevent="submit">
      <label class="field"><span>Request name</span><input ref="input" v-model="name" /></label>
      <label class="field">
        <span>Collection</span>
        <select v-model="collectionId" @change="folderId = ''">
          <option v-for="c in props.collections" :key="c.id" :value="c.id">{{ c.name }}</option>
          <option value="__new__">+ New collection…</option>
        </select>
      </label>
      <label v-if="creating" class="field"><span>New collection name</span><input v-model="newCollection" placeholder="e.g. Billing API" /></label>
      <label v-else-if="folderOptions.length" class="field">
        <span>Folder</span>
        <select v-model="folderId">
          <option value="">(collection root)</option>
          <option v-for="f in folderOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary" :disabled="!canSubmit">Save</button>
      </div>
    </form>
  </ModalShell>
</template>
