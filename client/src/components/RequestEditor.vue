<script setup lang="ts">
import { computed, ref } from 'vue';
import { METHODS, type Auth, type Body, type BodyMode, type RequestDraft } from '../types';
import KeyValueEditor from './KeyValueEditor.vue';
import { prettyJson } from '../lib/util';

type Section = 'params' | 'headers' | 'body' | 'auth';

const props = defineProps<{ draft: RequestDraft; sending: boolean; dirty: boolean }>();
const emit = defineEmits<{ 'update:draft': [d: RequestDraft]; send: []; save: []; copyCurl: [] }>();

const section = ref<Section>('params');
const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => emit('update:draft', { ...props.draft, [key]: value });
const count = (list: { enabled: boolean; key: string }[]) => list.filter((x) => x.enabled && x.key).length;
const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;

// body
const bodyModes: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'none' }, { id: 'json', label: 'JSON' }, { id: 'form', label: 'form-data' }, { id: 'urlencoded', label: 'x-www-form-urlencoded' }, { id: 'raw', label: 'raw' },
];
const body = computed(() => props.draft.body);
const setBody = (b: Body) => set('body', b);
const switchMode = (mode: BodyMode) => {
  if (mode === body.value.mode) return;
  const next: Body = { mode };
  if (mode === 'json' || mode === 'raw') next.content = body.value.content ?? '';
  if (mode === 'raw') next.contentType = body.value.contentType ?? 'text/plain';
  if (mode === 'form' || mode === 'urlencoded') next.fields = body.value.fields ?? [];
  setBody(next);
};
const jsonError = computed(() => body.value.mode === 'json' && body.value.content?.trim() && prettyJson(body.value.content) === null ? 'Not valid JSON (it will still be sent as-is)' : null);
const beautify = () => { const p = prettyJson(body.value.content ?? ''); if (p !== null) setBody({ ...body.value, content: p }); };

// auth
const auth = computed(() => props.draft.auth);
const setAuth = (patch: Partial<Auth>) => set('auth', { ...auth.value, ...patch });
</script>

<template>
  <div class="request-editor">
    <form class="url-bar" @submit.prevent="emit('send')">
      <select class="method-select" :class="'m-' + props.draft.method" :value="props.draft.method" @change="set('method', val($event) as RequestDraft['method'])">
        <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
      </select>
      <input class="url" :value="props.draft.url" placeholder="https://api.example.com/v1/things  —  use {{variables}} from your environment" spellcheck="false" autofocus @input="set('url', val($event))" />
      <button type="submit" class="primary send" :disabled="props.sending || !props.draft.url.trim()">{{ props.sending ? 'Sending…' : 'Send' }}</button>
      <button type="button" title="Save (Ctrl/Cmd+S)" :class="{ dirty: props.dirty }" @click="emit('save')">Save{{ props.dirty ? ' •' : '' }}</button>
      <button type="button" title="Copy as cURL" @click="emit('copyCurl')">cURL</button>
    </form>

    <div class="section-tabs">
      <button :class="{ active: section === 'params' }" @click="section = 'params'">Params<sup v-if="count(props.draft.params)">{{ count(props.draft.params) }}</sup></button>
      <button :class="{ active: section === 'headers' }" @click="section = 'headers'">Headers<sup v-if="count(props.draft.headers)">{{ count(props.draft.headers) }}</sup></button>
      <button :class="{ active: section === 'body' }" @click="section = 'body'">Body<sup v-if="body.mode !== 'none'">•</sup></button>
      <button :class="{ active: section === 'auth' }" @click="section = 'auth'">Auth<sup v-if="auth.type !== 'none'">•</sup></button>
    </div>

    <div class="section-body">
      <KeyValueEditor v-if="section === 'params'" :rows="props.draft.params" key-placeholder="Parameter" value-placeholder="Value" @update:rows="set('params', $event)" />
      <KeyValueEditor v-else-if="section === 'headers'" :rows="props.draft.headers" key-placeholder="Header" value-placeholder="Value" @update:rows="set('headers', $event)" />

      <div v-else-if="section === 'body'" class="body-editor">
        <div class="radio-row">
          <label v-for="m in bodyModes" :key="m.id"><input type="radio" name="bodymode" :checked="body.mode === m.id" @change="switchMode(m.id)" /> {{ m.label }}</label>
          <input v-if="body.mode === 'raw'" class="content-type" :value="body.contentType ?? ''" placeholder="Content-Type" spellcheck="false" @input="setBody({ ...body, contentType: val($event) })" />
          <button v-if="body.mode === 'json'" class="small" style="margin-left: auto" @click="beautify">Beautify</button>
        </div>
        <div v-if="body.mode === 'none'" class="hint">This request has no body.</div>
        <template v-else-if="body.mode === 'json' || body.mode === 'raw'">
          <textarea class="code" :value="body.content ?? ''" :placeholder="body.mode === 'json' ? '{\n  &quot;key&quot;: &quot;value&quot;\n}' : 'Request body'" spellcheck="false" @input="setBody({ ...body, content: val($event) })" />
          <div v-if="jsonError" class="hint warn">{{ jsonError }}</div>
        </template>
        <KeyValueEditor v-else :rows="body.fields ?? []" key-placeholder="Field" value-placeholder="Value" @update:rows="setBody({ ...body, fields: $event })" />
      </div>

      <div v-else class="auth-editor">
        <label class="field inline">
          <span>Type</span>
          <select :value="auth.type" @change="setAuth({ type: val($event) as Auth['type'] })">
            <option value="none">No auth</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
            <option value="apikey">API key</option>
          </select>
        </label>
        <div v-if="auth.type === 'none'" class="hint">No authorization header will be added. You can still set one manually under Headers.</div>
        <label v-if="auth.type === 'bearer'" class="field"><span>Token</span><input :value="auth.token ?? ''" placeholder="{{token}}" spellcheck="false" @input="setAuth({ token: val($event) })" /></label>
        <template v-if="auth.type === 'basic'">
          <label class="field"><span>Username</span><input :value="auth.username ?? ''" spellcheck="false" @input="setAuth({ username: val($event) })" /></label>
          <label class="field"><span>Password</span><input type="password" :value="auth.password ?? ''" @input="setAuth({ password: val($event) })" /></label>
        </template>
        <template v-if="auth.type === 'apikey'">
          <label class="field"><span>Key</span><input :value="auth.key ?? ''" placeholder="X-API-Key" spellcheck="false" @input="setAuth({ key: val($event) })" /></label>
          <label class="field"><span>Value</span><input :value="auth.value ?? ''" placeholder="{{apiKey}}" spellcheck="false" @input="setAuth({ value: val($event) })" /></label>
          <label class="field inline"><span>Add to</span>
            <select :value="auth.in ?? 'header'" @change="setAuth({ in: val($event) as 'header' | 'query' })">
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </label>
        </template>
      </div>
    </div>
  </div>
</template>
