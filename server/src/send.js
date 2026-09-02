import { normalizeRequest } from './db.js';

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Replace {{name}} placeholders with values from a variables map. Unknown names are left as-is. */
export function interpolate(str, vars) {
  if (typeof str !== 'string' || !str.includes('{{')) return str;
  return str.replace(VAR_RE, (match, name) => (Object.hasOwn(vars, name) ? vars[name] : match));
}

/** Turn an environment's variable list into a flat map, respecting `enabled`. */
export function variablesToMap(variables = []) {
  const map = {};
  for (const v of variables) if (v && v.enabled !== false && v.key) map[v.key] = v.value ?? '';
  return map;
}

/** Find unresolved {{vars}} in a string. */
export function unresolvedVariables(str, vars) {
  const out = new Set();
  if (typeof str !== 'string') return [];
  for (const m of str.matchAll(VAR_RE)) if (!Object.hasOwn(vars, m[1])) out.add(m[1]);
  return [...out];
}

function appendQuery(url, pairs) {
  if (pairs.length === 0) return url;
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  let base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  base += (base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?') + qs;
  return base + hash;
}

/**
 * Build a concrete fetch-able request from a stored request definition.
 * Returns { method, url, headers: [[k, v]], body, bodyDescription, warnings }.
 */
export function prepareRequest(input, vars = {}) {
  const req = normalizeRequest({ collectionId: 'x', ...input });
  const i = (s) => interpolate(s, vars);
  const warnings = [];

  let url = i(req.url.trim());
  const queryPairs = req.params.filter((p) => p.enabled && p.key).map((p) => [i(p.key), i(p.value)]);
  const headers = [];
  for (const h of req.headers) if (h.enabled && h.key) headers.push([i(h.key), i(h.value)]);
  const hasHeader = (name) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

  // auth
  const auth = req.auth;
  if (auth.type === 'bearer' && !hasHeader('authorization')) {
    headers.push(['Authorization', `Bearer ${i(auth.token)}`]);
  } else if (auth.type === 'basic' && !hasHeader('authorization')) {
    const creds = Buffer.from(`${i(auth.username)}:${i(auth.password)}`).toString('base64');
    headers.push(['Authorization', `Basic ${creds}`]);
  } else if (auth.type === 'apikey' && auth.key) {
    const keyName = i(auth.key);
    if (auth.in === 'query') queryPairs.push([keyName, i(auth.value)]);
    else if (!hasHeader(keyName)) headers.push([keyName, i(auth.value)]);
  }

  url = appendQuery(url, queryPairs);
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;

  // body
  let body;
  let bodyDescription = null;
  const b = req.body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (b.mode === 'json') {
      body = i(b.content);
      bodyDescription = body;
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
    } else if (b.mode === 'raw') {
      body = i(b.content);
      bodyDescription = body;
      if (!hasHeader('content-type')) headers.push(['Content-Type', b.contentType || 'text/plain']);
    } else if (b.mode === 'urlencoded') {
      const usp = new URLSearchParams();
      for (const f of b.fields) if (f.enabled && f.key) usp.append(i(f.key), i(f.value));
      body = usp.toString();
      bodyDescription = body;
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    } else if (b.mode === 'form') {
      const fd = new FormData();
      for (const f of b.fields) if (f.enabled && f.key) fd.append(i(f.key), i(f.value));
      body = fd;
      bodyDescription = '[multipart/form-data]';
      // fetch sets the multipart boundary header itself
    }
  } else if (b.mode !== 'none') {
    warnings.push(`Body ignored for ${req.method} requests.`);
  }

  for (const name of unresolvedVariables(templatedStrings(req).join(' '), vars)) {
    warnings.push(`Unresolved variable {{${name}}}.`);
  }

  return { method: req.method, url, headers, body, bodyDescription, warnings };
}

/** Every user-supplied string that gets interpolated when the request is sent (enabled rows only). */
export function templatedStrings(req) {
  const out = [req.url];
  const kv = (list) => { for (const x of list ?? []) if (x.enabled !== false && x.key) out.push(x.key, x.value); };
  kv(req.params);
  kv(req.headers);
  const b = req.body ?? {};
  if (b.mode === 'json' || b.mode === 'raw') out.push(b.content ?? '');
  if (b.mode === 'form' || b.mode === 'urlencoded') kv(b.fields);
  const a = req.auth ?? {};
  if (a.type === 'bearer') out.push(a.token ?? '');
  if (a.type === 'basic') out.push(a.username ?? '', a.password ?? '');
  if (a.type === 'apikey') out.push(a.key ?? '', a.value ?? '');
  return out.filter((s) => typeof s === 'string');
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|problem\+json|ld\+json)|.*\+(json|xml))/i;

function isTextual(contentType) {
  if (!contentType) return true;
  return TEXT_TYPES.test(contentType.split(';')[0].trim());
}

/** Execute a prepared request. Returns a serialisable response summary. */
export async function executeRequest(prepared, { timeoutMs = 30_000, followRedirects = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const time = Math.round(performance.now() - started);
    const contentType = res.headers.get('content-type') || '';
    const textual = isTextual(contentType);
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      contentType,
      body: textual ? buf.toString('utf8') : buf.toString('base64'),
      bodyEncoding: textual ? 'utf8' : 'base64',
      size: buf.length,
      time,
      redirected: res.redirected,
      finalUrl: res.url,
    };
  } catch (err) {
    const time = Math.round(performance.now() - started);
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? `Request timed out after ${timeoutMs} ms` : describeFetchError(err),
      time,
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(err) {
  // undici wraps the real network error in `cause`, sometimes as an AggregateError (IPv4 + IPv6 attempts).
  let cause = err?.cause ?? err;
  if (Array.isArray(cause?.errors) && cause.errors.length) cause = cause.errors[0];
  if (cause?.code) return `${cause.code}: ${cause.message ?? err.message}`;
  return cause?.message || err?.message || String(err);
}

/** Produce a curl command equivalent to the prepared request. */
export function toCurl(prepared) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const lines = [`curl -X ${prepared.method} ${q(prepared.url)}`];
  for (const [k, v] of prepared.headers) lines.push(`-H ${q(`${k}: ${v}`)}`);
  if (prepared.body instanceof FormData) {
    for (const [k, v] of prepared.body.entries()) lines.push(`-F ${q(`${k}=${v}`)}`);
  } else if (typeof prepared.body === 'string' && prepared.body.length) {
    lines.push(`--data-raw ${q(prepared.body)}`);
  }
  return lines.join(' \\\n  ');
}
