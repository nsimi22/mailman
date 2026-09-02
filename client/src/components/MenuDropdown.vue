<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';

export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; separator?: boolean }

const props = withDefaults(defineProps<{ items: MenuItem[]; title?: string }>(), { title: 'More' });
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const onDown = (e: MouseEvent) => { if (!root.value?.contains(e.target as Node)) open.value = false; };
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open.value = false; };
watch(open, (v) => {
  if (v) { window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey); }
  else { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); }
});
onUnmounted(() => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); });

const pick = (it: MenuItem) => { open.value = false; it.onClick?.(); };
</script>

<template>
  <div ref="root" class="menu" :class="{ open }" @click.stop>
    <button class="icon" :title="props.title" @click.stop="open = !open"><slot>⋯</slot></button>
    <div v-if="open" class="menu-pop">
      <template v-for="(it, i) in props.items" :key="i">
        <div v-if="it.separator" class="menu-sep" />
        <button v-else :class="{ danger: it.danger }" @click="pick(it)">{{ it.label }}</button>
      </template>
    </div>
  </div>
</template>
