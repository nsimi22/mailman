import { useRef, useState } from 'react';
import { Modal } from './Dialogs';

export function ImportDialog({ onImport, onClose }: { onImport: (json: unknown) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const submit = async () => {
    setError(null);
    let json: unknown;
    try { json = JSON.parse(text); } catch { setError('That is not valid JSON.'); return; }
    setBusy(true);
    try { await onImport(json); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Import" onClose={onClose} width={640}>
      <p className="hint">Import a Postman collection (v2.0 / v2.1) or a Postman environment export. In Postman: right-click a collection → Export.</p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
        onClick={() => fileRef.current?.click()}
      >
        Drop a .json file here or click to choose
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
      </div>
      <label className="field">
        <span>…or paste the JSON</span>
        <textarea className="code" rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder='{ "info": { "name": "My API" }, "item": [ ... ] }' />
      </label>
      {error && <div className="hint warn">{error}</div>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={busy || !text.trim()} onClick={submit}>Import</button>
      </div>
    </Modal>
  );
}
