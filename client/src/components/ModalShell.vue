<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = withDefaults(defineProps<{ title: string; width?: number }>(), { width: 460 });
const emit = defineEmits<{ close: [] }>();

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" :style="{ width: props.width + 'px' }" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ props.title }}</h3>
        <button class="icon" title="Close" @click="emit('close')">×</button>
      </div>
      <div class="modal-body"><slot /></div>
    </div>
  </div>
</template>
