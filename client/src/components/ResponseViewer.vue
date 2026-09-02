<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SendResult } from '../types';
import { copyText, formatBytes, formatTime, prettyJson, statusClass } from '../lib/util';

type View = 'body' | 'headers' | 'sent';
const props = defineProps<{ result: SendResult | null; sending: boolean }>();
const emit = defineEmits<{ toast: [message: string] }>();

const view = ref<View>('body');
const pretty = ref(true);
const wrap = ref(true);

const isJson = computed(() => !!props.result?.contentType && /json/i.test(props.result.contentType));
const isImage = computed(() => !!props.result?.contentType && /^image\//i.test(props.result.contentType) && props.result.bodyEncoding === 'base64');
const prettyBody = computed(() => {
  const r = props.result;
  if (!r?.body || r.bodyEncoding === 'base64') return null;
  return isJson.value || /^[\[{]/.test(r.body.trimStart()) ? prettyJson(r.body) : null;
});
const shownBody = computed(() => (pretty.value && prettyBody.value !== null ? prettyBody.value : props.result?.body ?? ''));
const sentText = computed(() => {
  const s = props.result?.sent;
  if (!s) return '';
  const headers = s.headers.map(([k, v]) => `${k}: ${k.toLowerCase() === 'authorization' ? '••••••' : v}`).join('\n');
  return `${s.method} ${s.url}\n${headers}${s.body ? `\n\n${s.body}` : ''}`;
});
const copy = async () => emit('toast', (await copyText(shownBody.value)) ? 'Copied response body' : 'Copy failed');
</script>

<template>
  <div class="response">
    <div v-if="props.sending" class="response-empty"><span class="spinner" /> Sending…</div>
    <div v-else-if="!props.result" class="response-empty">Send a request to see the response here.<br /><kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends, <kbd>Ctrl</kbd> + <kbd>S</kbd> saves.</div>
    <template v-else>
      <div class="response-head">
        <template v-if="props.result.ok">
          <span class="status-pill" :class="statusClass(props.result.status)">{{ props.result.status }} {{ props.result.statusText }}</span>
          <span class="meta">{{ formatTime(props.result.time) }}</span>
          <span class="meta">{{ formatBytes(props.result.size) }}</span>
          <span v-if="props.result.redirected" class="meta" :title="props.result.finalUrl">redirected</span>
        </template>
        <template v-else>
          <span class="status-pill err">Error</span>
          <span class="meta">{{ formatTime(props.result.time) }}</span>
        </template>
        <div class="spacer" />
        <div class="section-tabs compact">
          <button :class="{ active: view === 'body' }" @click="view = 'body'">Body</button>
          <button :class="{ active: view === 'headers' }" @click="view = 'headers'">Headers<sup v-if="props.result.headers">{{ props.result.headers.length }}</sup></button>
          <button :class="{ active: view === 'sent' }" @click="view = 'sent'">Request sent</button>
        </div>
      </div>

      <div v-if="props.result.warnings?.length" class="warnings"><div v-for="(w, i) in props.result.warnings" :key="i">⚠ {{ w }}</div></div>

      <div v-if="!props.result.ok" class="response-body error-body">
        <strong>Could not complete the request.</strong>
        <pre>{{ props.result.error }}</pre>
        <p class="hint">Check the URL, your network, and that the target server is reachable from the mailman server.</p>
      </div>

      <div v-else-if="view === 'body'" class="response-body">
        <div class="body-toolbar">
          <label v-if="prettyBody !== null"><input v-model="pretty" type="checkbox" /> Pretty</label>
          <label><input v-model="wrap" type="checkbox" /> Wrap</label>
          <span class="spacer" />
          <button v-if="props.result.body && props.result.bodyEncoding !== 'base64'" class="small" @click="copy">Copy</button>
        </div>
        <div v-if="isImage" class="image-body"><img :src="`data:${props.result.contentType};base64,${props.result.body}`" alt="response" /></div>
        <div v-else-if="props.result.bodyEncoding === 'base64'" class="hint">Binary response ({{ props.result.contentType || 'unknown type' }}, {{ formatBytes(props.result.size) }}). Not displayed.</div>
        <pre v-else class="code-view" :class="{ wrap }">{{ shownBody || '(empty body)' }}</pre>
      </div>

      <div v-else-if="view === 'headers'" class="response-body">
        <table class="headers-table"><tbody>
          <tr v-for="([k, v], i) in props.result.headers ?? []" :key="i"><td class="hk">{{ k }}</td><td>{{ v }}</td></tr>
        </tbody></table>
      </div>

      <div v-else class="response-body"><pre class="code-view wrap">{{ sentText }}</pre></div>
    </template>
  </div>
</template>
