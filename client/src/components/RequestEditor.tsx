import { useState } from 'react';
import { METHODS, type Auth, type Body, type BodyMode, type RequestDraft } from '../types';
import { KeyValueEditor } from './KeyValueEditor';
import { prettyJson } from '../lib/util';

type Section = 'params' | 'headers' | 'body' | 'auth';

interface Props {
  draft: RequestDraft;
  onChange: (next: RequestDraft) => void;
  onSend: () => void;
  onSave: () => void;
  onCopyCurl: () => void;
  sending: boolean;
  dirty: boolean;
}

export function RequestEditor({ draft, onChange, onSend, onSave, onCopyCurl, sending, dirty }: Props) {
  const [section, setSection] = useState<Section>('params');
  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => onChange({ ...draft, [key]: value });
  const count = (list: { enabled: boolean; key: string }[]) => list.filter((x) => x.enabled && x.key).length;

  return (
    <div className="request-editor">
      <form className="url-bar" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
        <select className={`method-select m-${draft.method}`} value={draft.method} onChange={(e) => set('method', e.target.value as RequestDraft['method'])}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          className="url"
          value={draft.url}
          placeholder="https://api.example.com/v1/things  —  use {{variables}} from your environment"
          onChange={(e) => set('url', e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <button type="submit" className="primary send" disabled={sending || !draft.url.trim()}>{sending ? 'Sending…' : 'Send'}</button>
        <button type="button" onClick={onSave} title="Save (Ctrl/Cmd+S)" className={dirty ? 'dirty' : ''}>Save{dirty ? ' •' : ''}</button>
        <button type="button" onClick={onCopyCurl} title="Copy as cURL">cURL</button>
      </form>

      <div className="section-tabs">
        <button className={section === 'params' ? 'active' : ''} onClick={() => setSection('params')}>Params{count(draft.params) ? <sup>{count(draft.params)}</sup> : null}</button>
        <button className={section === 'headers' ? 'active' : ''} onClick={() => setSection('headers')}>Headers{count(draft.headers) ? <sup>{count(draft.headers)}</sup> : null}</button>
        <button className={section === 'body' ? 'active' : ''} onClick={() => setSection('body')}>Body{draft.body.mode !== 'none' ? <sup>•</sup> : null}</button>
        <button className={section === 'auth' ? 'active' : ''} onClick={() => setSection('auth')}>Auth{draft.auth.type !== 'none' ? <sup>•</sup> : null}</button>
      </div>

      <div className="section-body">
        {section === 'params' && (
          <KeyValueEditor rows={draft.params} onChange={(rows) => set('params', rows)} keyPlaceholder="Parameter" valuePlaceholder="Value" />
        )}
        {section === 'headers' && (
          <KeyValueEditor rows={draft.headers} onChange={(rows) => set('headers', rows)} keyPlaceholder="Header" valuePlaceholder="Value" />
        )}
        {section === 'body' && <BodyEditor body={draft.body} onChange={(b) => set('body', b)} />}
        {section === 'auth' && <AuthEditor auth={draft.auth} onChange={(a) => set('auth', a)} />}
      </div>
    </div>
  );
}

function BodyEditor({ body, onChange }: { body: Body; onChange: (b: Body) => void }) {
  const modes: { id: BodyMode; label: string }[] = [
    { id: 'none', label: 'none' },
    { id: 'json', label: 'JSON' },
    { id: 'form', label: 'form-data' },
    { id: 'urlencoded', label: 'x-www-form-urlencoded' },
    { id: 'raw', label: 'raw' },
  ];
  const switchMode = (mode: BodyMode) => {
    if (mode === body.mode) return;
    const next: Body = { mode };
    if (mode === 'json' || mode === 'raw') next.content = body.content ?? '';
    if (mode === 'raw') next.contentType = body.contentType ?? 'text/plain';
    if (mode === 'form' || mode === 'urlencoded') next.fields = body.fields ?? [];
    onChange(next);
  };
  const jsonError = body.mode === 'json' && body.content?.trim() ? (prettyJson(body.content) === null ? 'Not valid JSON (it will still be sent as-is)' : null) : null;

  return (
    <div className="body-editor">
      <div className="radio-row">
        {modes.map((m) => (
          <label key={m.id}><input type="radio" name="bodymode" checked={body.mode === m.id} onChange={() => switchMode(m.id)} /> {m.label}</label>
        ))}
        {body.mode === 'raw' && (
          <input className="content-type" value={body.contentType ?? ''} placeholder="Content-Type" onChange={(e) => onChange({ ...body, contentType: e.target.value })} spellCheck={false} />
        )}
        {body.mode === 'json' && (
          <button className="small" style={{ marginLeft: 'auto' }} onClick={() => { const p = prettyJson(body.content ?? ''); if (p !== null) onChange({ ...body, content: p }); }}>Beautify</button>
        )}
      </div>
      {body.mode === 'none' && <div className="hint">This request has no body.</div>}
      {(body.mode === 'json' || body.mode === 'raw') && (
        <>
          <textarea
            className="code"
            value={body.content ?? ''}
            placeholder={body.mode === 'json' ? '{\n  "key": "value"\n}' : 'Request body'}
            onChange={(e) => onChange({ ...body, content: e.target.value })}
            spellCheck={false}
          />
          {jsonError && <div className="hint warn">{jsonError}</div>}
        </>
      )}
      {(body.mode === 'form' || body.mode === 'urlencoded') && (
        <KeyValueEditor rows={body.fields ?? []} onChange={(fields) => onChange({ ...body, fields })} keyPlaceholder="Field" valuePlaceholder="Value" />
      )}
    </div>
  );
}

function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (a: Auth) => void }) {
  const setType = (type: Auth['type']) => onChange({ ...auth, type });
  return (
    <div className="auth-editor">
      <label className="field inline">
        <span>Type</span>
        <select value={auth.type} onChange={(e) => setType(e.target.value as Auth['type'])}>
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apikey">API key</option>
        </select>
      </label>
      {auth.type === 'none' && <div className="hint">No authorization header will be added. You can still set one manually under Headers.</div>}
      {auth.type === 'bearer' && (
        <label className="field"><span>Token</span><input value={auth.token ?? ''} onChange={(e) => onChange({ ...auth, token: e.target.value })} placeholder="{{token}}" spellCheck={false} /></label>
      )}
      {auth.type === 'basic' && (
        <>
          <label className="field"><span>Username</span><input value={auth.username ?? ''} onChange={(e) => onChange({ ...auth, username: e.target.value })} spellCheck={false} /></label>
          <label className="field"><span>Password</span><input type="password" value={auth.password ?? ''} onChange={(e) => onChange({ ...auth, password: e.target.value })} /></label>
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <label className="field"><span>Key</span><input value={auth.key ?? ''} onChange={(e) => onChange({ ...auth, key: e.target.value })} placeholder="X-API-Key" spellCheck={false} /></label>
          <label className="field"><span>Value</span><input value={auth.value ?? ''} onChange={(e) => onChange({ ...auth, value: e.target.value })} placeholder="{{apiKey}}" spellCheck={false} /></label>
          <label className="field inline"><span>Add to</span>
            <select value={auth.in ?? 'header'} onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}
