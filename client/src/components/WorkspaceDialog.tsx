import { useEffect, useState } from 'react';
import { Modal } from './Dialogs';
import { desktop, type DesktopSettings } from '../lib/desktop';

/** Desktop only: choose between the built-in local workspace and a shared team server. */
export function WorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { desktop?.getSettings().then(setSettings); }, []);
  if (!desktop || !settings) return null;
  const bridge = desktop;

  const test = async () => {
    setBusy(true); setStatus({ kind: 'info', text: 'Connecting…' });
    const r = await bridge.testConnection(settings);
    setStatus(r.ok ? { kind: 'ok', text: 'Connected. The team server is reachable.' } : { kind: 'err', text: r.error ?? 'Could not connect.' });
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    const r = await bridge.setSettings(settings);
    setBusy(false);
    if (!r.ok) { setStatus({ kind: 'err', text: r.error ?? 'Could not save.' }); return; }
    window.location.reload();
  };

  return (
    <Modal title="Workspace" onClose={onClose} width={560}>
      <div className="radio-stack">
        <label>
          <input type="radio" checked={settings.mode === 'local'} onChange={() => setSettings({ ...settings, mode: 'local' })} />
          <div><strong>Local</strong><div className="hint">Collections are stored only on this computer. Works offline.</div></div>
        </label>
        <label>
          <input type="radio" checked={settings.mode === 'remote'} onChange={() => setSettings({ ...settings, mode: 'remote' })} />
          <div><strong>Team server</strong><div className="hint">Connect to a shared mailman server so everyone on the team sees the same collections and environments.</div></div>
        </label>
      </div>
      {settings.mode === 'remote' && (
        <>
          <label className="field"><span>Server URL</span>
            <input value={settings.serverUrl} onChange={(e) => setSettings({ ...settings, serverUrl: e.target.value })} placeholder="https://mailman.internal.example.com" spellCheck={false} />
          </label>
          <label className="field"><span>Team password <small className="hint">(leave blank if the server has none)</small></span>
            <input type="password" value={settings.password} onChange={(e) => setSettings({ ...settings, password: e.target.value })} />
          </label>
          <button type="button" className="small" onClick={test} disabled={busy || !settings.serverUrl.trim()}>Test connection</button>
        </>
      )}
      {status && <div className={`hint ${status.kind === 'err' ? 'warn' : status.kind === 'ok' ? 'ok' : ''}`} style={{ marginTop: 8 }}>{status.text}</div>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={busy || (settings.mode === 'remote' && !settings.serverUrl.trim())} onClick={save}>Save &amp; reload</button>
      </div>
    </Modal>
  );
}
