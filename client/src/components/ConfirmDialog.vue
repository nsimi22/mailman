<script setup lang="ts">
import ModalShell from './ModalShell.vue';

const props = withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), { confirmLabel: 'Delete' });
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <ModalShell :title="props.title" @close="emit('close')">
    <p>{{ props.message }}</p>
    <div class="modal-actions">
      <button autofocus @click="emit('close')">Cancel</button>
      <button class="danger" @click="emit('confirm')">{{ props.confirmLabel }}</button>
    </div>
  </ModalShell>
</template>
