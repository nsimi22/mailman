<script setup lang="ts">
import type { KeyValue } from '../types';

const props = withDefaults(defineProps<{ rows: KeyValue[]; keyPlaceholder?: string; valuePlaceholder?: string; secretValues?: boolean }>(), {
  keyPlaceholder: 'Key', valuePlaceholder: 'Value', secretValues: false,
});
const emit = defineEmits<{ 'update:rows': [rows: KeyValue[]] }>();

const update = (i: number, patch: Partial<KeyValue>) => emit('update:rows', props.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
const add = (patch: Partial<KeyValue>) => emit('update:rows', [...props.rows, { key: '', value: '', enabled: true, ...patch }]);
const remove = (i: number) => emit('update:rows', props.rows.filter((_, idx) => idx !== i));
const val = (e: Event) => (e.target as HTMLInputElement).value;
</script>

<template>
  <table class="kv">
    <thead>
      <tr><th style="width: 28px"></th><th>{{ props.keyPlaceholder }}</th><th>{{ props.valuePlaceholder }}</th><th style="width: 28px"></th></tr>
    </thead>
    <tbody>
      <tr v-for="(r, i) in props.rows" :key="i" :class="{ disabled: !r.enabled }">
        <td><input type="checkbox" :checked="r.enabled" @change="update(i, { enabled: (($event.target as HTMLInputElement).checked) })" /></td>
        <td><input :value="r.key" :placeholder="props.keyPlaceholder" spellcheck="false" @input="update(i, { key: val($event) })" /></td>
        <td><input :value="r.value" :placeholder="props.valuePlaceholder" :type="props.secretValues ? 'password' : 'text'" spellcheck="false" @input="update(i, { value: val($event) })" /></td>
        <td><button class="icon" title="Remove" @click="remove(i)">×</button></td>
      </tr>
      <tr class="phantom" :key="'phantom-' + props.rows.length">
        <td></td>
        <td><input value="" :placeholder="props.keyPlaceholder" spellcheck="false" @input="add({ key: val($event) })" /></td>
        <td><input value="" :placeholder="props.valuePlaceholder" spellcheck="false" @input="add({ value: val($event) })" /></td>
        <td></td>
      </tr>
    </tbody>
  </table>
</template>
