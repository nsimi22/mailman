import { useState } from 'react';
import type { Environment, Variable } from '../types';
import { Modal } from './Dialogs';

interface Props {
  environment: Environment | null; // null = create
  onSave: (name: string, variables: Variable[]) => Promise<void>;
  onClose: () => void;
}

export function EnvironmentEditor({ environment, onSave, onClose }: Props) {
  const [name, setName] = useState(environment?.name ?? '');
  const [vars, setVars] = useState<Variable[]>(environment?.variables ?? []);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  const update = (i: number, patch: Partial<Variable>) => setVars((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const add = (patch: Partial<Variable>) => setVars((v) => [...v, { key: '', value: '', enabled: true, secret: false, ...patch }]);
  const remove = (i: number) => setVars((v) => v.filter((_, idx) => idx !== i));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave(name.trim(), vars.filter((v) => v.key.trim())); } finally { setBusy(false); }
  };

  return (
    <Modal title={environment ? `Edit environment` : 'New environment'} onClose={onClose} width={720}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Staging" autoFocus />
        </label>
        <div className="field">
          <span>Variables <small className="hint">— use them as <code>{'{{name}}'}</code> in URLs, headers, bodies and auth</small></span>
          <table className="kv">
            <thead>
              <tr><th style={{ width: 28 }}></th><th>Variable</th><th>Value</th><th style={{ width: 60 }}>Secret</th><th style={{ width: 28 }}></th></tr>
            </thead>
            <tbody>
              {vars.map((v, i) => (
                <tr key={i} className={v.enabled ? '' : 'disabled'}>
                  <td><input type="checkbox" checked={v.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></td>
                  <td><input value={v.key} placeholder="baseUrl" onChange={(e) => update(i, { key: e.target.value })} spellCheck={false} /></td>
                  <td><input value={v.value} type={v.secret && !reveal ? 'password' : 'text'} placeholder="https://…" onChange={(e) => update(i, { value: e.target.value })} spellCheck={false} /></td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={v.secret} onChange={(e) => update(i, { secret: e.target.checked })} title="Mask this value in the editor" /></td>
                  <td><button type="button" className="icon" onClick={() => remove(i)} title="Remove">×</button></td>
                </tr>
              ))}
              <tr className="phantom">
                <td></td>
                <td><input value="" placeholder="Variable" onChange={(e) => add({ key: e.target.value })} spellCheck={false} /></td>
                <td><input value="" placeholder="Value" onChange={(e) => add({ value: e.target.value })} spellCheck={false} /></td>
                <td></td><td></td>
              </tr>
            </tbody>
          </table>
          {vars.some((v) => v.secret) && (
            <label className="hint" style={{ marginTop: 6 }}><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Reveal secret values</label>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>{environment ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}
