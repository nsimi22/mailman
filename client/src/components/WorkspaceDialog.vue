<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ModalShell from './ModalShell.vue';
import { desktop, type DesktopSettings } from '../lib/desktop';

const emit = defineEmits<{ close: [] }>();
const settings = ref<DesktopSettings | null>(null);
const status = ref<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
const busy = ref(false);

onMounted(async () => { if (desktop) settings.value = await desktop.getSettings(); });

const test = async () => {
  if (!desktop || !settings.value) return;
  busy.value = true; status.value = { kind: 'info', text: 'Connecting…' };
  try {
    const r = await desktop.testConnection(settings.value);
    status.value = r.ok ? { kind: 'ok', text: 'Connected. The team server is reachable.' } : { kind: 'err', text: r.error ?? 'Could not connect.' };
  } catch (e) {
    status.value = { kind: 'err', text: (e as Error).message };
  } finally {
    // Always clear `busy`: leaving it set would disable every button in the dialog.
    busy.value = false;
  }
};

const save = async () => {
  if (!desktop || !settings.value) return;
  busy.value = true;
  try {
    const r = await desktop.setSettings(settings.value);
    if (!r.ok) { status.value = { kind: 'err', text: r.error ?? 'Could not save.' }; return; }
    window.location.reload();
  } catch (e) {
    status.value = { kind: 'err', text: (e as Error).message };
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <ModalShell v-if="settings" title="Workspace" :width="560" @close="emit('close')">
    <div class="radio-stack">
      <label>
        <input v-model="settings.mode" type="radio" value="local" />
        <div><strong>Local</strong><div class="hint">Collections are stored only on this computer. Works offline.</div></div>
      </label>
      <label>
        <input v-model="settings.mode" type="radio" value="remote" />
        <div><strong>Team server</strong><div class="hint">Connect to a shared mailman server so everyone on the team sees the same collections and environments.</div></div>
      </label>
    </div>
    <template v-if="settings.mode === 'remote'">
      <label class="field"><span>Server URL</span><input v-model="settings.serverUrl" placeholder="https://mailman.internal.example.com" spellcheck="false" /></label>
      <label class="field"><span>Team password <small class="hint">(leave blank if the server has none)</small></span><input v-model="settings.password" type="password" /></label>
      <button type="button" class="small" :disabled="busy || !settings.serverUrl.trim()" @click="test">Test connection</button>
    </template>
    <div v-if="status" class="hint workspace-status" :class="{ warn: status.kind === 'err', ok: status.kind === 'ok' }" style="margin-top: 8px">{{ status.text }}</div>
    <div class="modal-actions">
      <button type="button" @click="emit('close')">Cancel</button>
      <button type="button" class="primary" :disabled="busy || (settings.mode === 'remote' && !settings.serverUrl.trim())" @click="save">Save &amp; reload</button>
    </div>
  </ModalShell>
</template>
