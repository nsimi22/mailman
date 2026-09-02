<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ModalShell from './ModalShell.vue';

const props = withDefaults(defineProps<{ title: string; label: string; initial?: string; submitLabel?: string }>(), { initial: '', submitLabel: 'OK' });
const emit = defineEmits<{ submit: [value: string]; close: [] }>();
const value = ref(props.initial);
const input = ref<HTMLInputElement | null>(null);
onMounted(() => { input.value?.focus(); input.value?.select(); });
const submit = () => { if (value.value.trim()) emit('submit', value.value.trim()); };
</script>

<template>
  <ModalShell :title="props.title" @close="emit('close')">
    <form @submit.prevent="submit">
      <label class="field"><span>{{ props.label }}</span><input ref="input" v-model="value" /></label>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="primary" :disabled="!value.trim()">{{ props.submitLabel }}</button>
      </div>
    </form>
  </ModalShell>
</template>
