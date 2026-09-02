<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Environment, Variable } from '../types';
import ModalShell from './ModalShell.vue';

const props = defineProps<{ environment: Environment | null; save: (name: string, variables: Variable[]) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();

const name = ref(props.environment?.name ?? '');
const vars = ref<Variable[]>((props.environment?.variables ?? []).map((v) => ({ ...v })));
const busy = ref(false);
const reveal = ref(false);
const hasSecret = computed(() => vars.value.some((v) => v.secret));
const val = (e: Event) => (e.target as HTMLInputElement).value;

const add = (patch: Partial<Variable>) => vars.value.push({ key: '', value: '', enabled: true, secret: false, ...patch });
const remove = (i: number) => vars.value.splice(i, 1);

const submit = async () => {
  if (!name.value.trim()) return;
  busy.value = true;
  try { await props.save(name.value.trim(), vars.value.filter((v) => v.key.trim())); } finally { busy.value = false; }
};
</script>

<template>
  <ModalShell :title="props.environment ? 'Edit environment' : 'New environment'" :width="720" @close="emit('close')">
    <form @submit.prevent="submit">
      <label class="field"><span>Name</span><input v-model="name" placeholder="e.g. Staging" autofocus /></label>
      <div class="field">
        <span>Variables <small class="hint">— use them as <code v-text="'{{name}}'"></code> in URLs, headers, bodies and auth</small></span>
        <table class="kv">
          <thead><tr><th style="width: 28px"></th><th>Variable</th><th>Value</th><th style="width: 60px">Secret</th><th style="width: 28px"></th></tr></thead>
          <tbody>
            <tr v-for="(v, i) in vars" :key="i" :class="{ disabled: !v.enabled }">
              <td><input v-model="v.enabled" type="checkbox" /></td>
              <td><input v-model="v.key" placeholder="baseUrl" spellcheck="false" /></td>
              <td><input v-model="v.value" :type="v.secret && !reveal ? 'password' : 'text'" placeholder="https://…" spellcheck="false" /></td>
              <td style="text-align: center"><input v-model="v.secret" type="checkbox" title="Mask this value in the editor" /></td>
              <td><button type="button" class="icon" title="Remove" @click="remove(i)">×</button></td>
            </tr>
            <tr class="phantom" :key="'phantom-' + vars.length">
              <td></td>
              <td><input value="" placeholder="Variable" spellcheck="false" @input="add({ key: val($event) })" /></td>
              <td><input value="" placeholder="Value" spellcheck="false" @input="add({ value: val($event) })" /></td>
              <td></td><td></td>
            </tr>
          </tbody>
        </table>
        <label v-if="hasSecret" class="hint" style="margin-top: 6px"><input v-model="reveal" type="checkbox" /> Reveal secret values</label>
      </div>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary" :disabled="busy || !name.trim()">{{ props.environment ? 'Save' : 'Create' }}</button>
      </div>
    </form>
  </ModalShell>
</template>
