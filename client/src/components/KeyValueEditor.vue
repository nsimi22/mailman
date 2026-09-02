<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { KeyValue } from '../types';

const props = withDefaults(defineProps<{ rows: KeyValue[]; keyPlaceholder?: string; valuePlaceholder?: string; secretValues?: boolean }>(), {
  keyPlaceholder: 'Key', valuePlaceholder: 'Value', secretValues: false,
});
const emit = defineEmits<{ 'update:rows': [rows: KeyValue[]] }>();
const body = ref<HTMLTableSectionElement | null>(null);

const update = (i: number, patch: Partial<KeyValue>) => emit('update:rows', props.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
const remove = (i: number) => emit('update:rows', props.rows.filter((_, idx) => idx !== i));
const val = (e: Event) => (e.target as HTMLInputElement).value;

/**
 * The phantom row becomes a real row on the first keystroke. Focus then moves into the new
 * row's matching input so the rest of the typing lands there (Postman-style), and the phantom
 * is reset to empty for the next entry.
 */
const startRow = async (e: Event, column: 'key' | 'value') => {
  const text = val(e);
  (e.target as HTMLInputElement).value = '';
  if (!text) return;
  emit('update:rows', [...props.rows, { key: '', value: '', enabled: true, [column]: text }]);
  await nextTick();
  const rowsEls = body.value?.querySelectorAll<HTMLTableRowElement>('tr:not(.phantom)');
  const input = rowsEls?.[rowsEls.length - 1]?.querySelector<HTMLInputElement>(`input[data-col="${column}"]`);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
};
</script>

<template>
  <table class="kv">
    <thead>
      <tr><th style="width: 28px"></th><th>{{ props.keyPlaceholder }}</th><th>{{ props.valuePlaceholder }}</th><th style="width: 28px"></th></tr>
    </thead>
    <tbody ref="body">
      <tr v-for="(r, i) in props.rows" :key="i" :class="{ disabled: !r.enabled }">
        <td><input type="checkbox" :checked="r.enabled" @change="update(i, { enabled: (($event.target as HTMLInputElement).checked) })" /></td>
        <td><input data-col="key" :value="r.key" :placeholder="props.keyPlaceholder" spellcheck="false" @input="update(i, { key: val($event) })" /></td>
        <td><input data-col="value" :value="r.value" :placeholder="props.valuePlaceholder" :type="props.secretValues ? 'password' : 'text'" spellcheck="false" @input="update(i, { value: val($event) })" /></td>
        <td><button class="icon" title="Remove" @click="remove(i)">×</button></td>
      </tr>
      <tr class="phantom">
        <td></td>
        <td><input :placeholder="props.keyPlaceholder" spellcheck="false" @input="startRow($event, 'key')" /></td>
        <td><input :placeholder="props.valuePlaceholder" spellcheck="false" @input="startRow($event, 'value')" /></td>
        <td></td>
      </tr>
    </tbody>
  </table>
</template>
