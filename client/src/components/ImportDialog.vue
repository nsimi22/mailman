<script setup lang="ts">
import { ref } from 'vue';
import ModalShell from './ModalShell.vue';

const props = defineProps<{
  importJson: (json: unknown) => Promise<void>;
  linkOpenApi: (url: string, name: string) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();

const mode = ref<'file' | 'openapi'>('file');
const text = ref('');
const url = ref('');
const name = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const readFile = (file: File) => {
  const reader = new FileReader();
  reader.onload = () => { text.value = String(reader.result ?? ''); };
  reader.readAsText(file);
};
const onFile = (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) readFile(f); };
const onDrop = (e: DragEvent) => { const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); };

const submit = async () => {
  error.value = null;
  busy.value = true;
  try {
    if (mode.value === 'openapi') {
      await props.linkOpenApi(url.value.trim(), name.value.trim());
    } else {
      let json: unknown;
      try { json = JSON.parse(text.value); } catch { error.value = 'That is not valid JSON.'; return; }
      await props.importJson(json);
    }
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
};
</script>

<template>
  <ModalShell title="Import" :width="640" @close="emit('close')">
    <div class="section-tabs" style="margin: -4px 0 12px">
      <button :class="{ active: mode === 'file' }" @click="mode = 'file'">Postman file</button>
      <button :class="{ active: mode === 'openapi' }" @click="mode = 'openapi'">Link an OpenAPI spec (auto-sync)</button>
    </div>

    <template v-if="mode === 'file'">
      <p class="hint">Import a Postman collection (v2.0 / v2.1), a Postman environment export, or an OpenAPI / Swagger document. In Postman: right-click a collection → Export.</p>
      <div class="dropzone" @dragover.prevent @drop.prevent="onDrop" @click="fileInput?.click()">
        Drop a .json file here or click to choose
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
      </div>
      <label class="field">
        <span>…or paste the JSON</span>
        <textarea v-model="text" class="code" rows="8" spellcheck="false" placeholder='{ "info": { "name": "My API" }, "item": [ ... ] }' />
      </label>
    </template>

    <template v-else>
      <p class="hint">Point mailman at a service's OpenAPI / Swagger document (JSON or YAML). The server re-reads it periodically, so when someone adds an endpoint it appears here for the whole team. The collection is managed by the sync; copy a request into another collection to customise it.</p>
      <label class="field"><span>Spec URL</span><input v-model="url" placeholder="https://nexus.internal/openapi.json" spellcheck="false" /></label>
      <label class="field"><span>Collection name <small class="hint">(optional, defaults to the spec title)</small></span><input v-model="name" placeholder="Nexus" /></label>
    </template>

    <div v-if="error" class="hint warn">{{ error }}</div>
    <div class="modal-actions">
      <button type="button" @click="emit('close')">Cancel</button>
      <button type="button" class="primary" :disabled="busy || (mode === 'file' ? !text.trim() : !url.trim())" @click="submit">{{ mode === 'file' ? 'Import' : 'Link & sync' }}</button>
    </div>
  </ModalShell>
</template>
