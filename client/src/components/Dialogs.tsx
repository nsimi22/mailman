import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Collection } from '../types';

export function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function PromptDialog({ title, label, initial = '', submitLabel = 'OK', onSubmit, onClose }: {
  title: string; label: string; initial?: string; submitLabel?: string; onSubmit: (value: string) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
        <label className="field">
          <span>{label}</span>
          <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!value.trim()}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onClose }: {
  title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="modal-actions">
        <button onClick={onClose} autoFocus>Cancel</button>
        <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export interface SaveTarget { name: string; collectionId: string; folderId: string | null }

export function SaveDialog({ collections, initialName, initialCollectionId, initialFolderId, onSubmit, onClose, onCreateCollection }: {
  collections: Collection[];
  initialName: string;
  initialCollectionId?: string | null;
  initialFolderId?: string | null;
  onSubmit: (t: SaveTarget) => void;
  onClose: () => void;
  onCreateCollection: (name: string) => Promise<Collection>;
}) {
  const [name, setName] = useState(initialName);
  const [collectionId, setCollectionId] = useState(initialCollectionId ?? collections[0]?.id ?? '');
  const [folderId, setFolderId] = useState<string>(initialFolderId ?? '');
  const [newCollection, setNewCollection] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const collection = collections.find((c) => c.id === collectionId);
  const folderOptions = collection ? flattenFolders(collection) : [];
  const creating = collections.length === 0 || collectionId === '__new__';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    let targetCollection = collectionId;
    if (creating) {
      if (!newCollection.trim()) return;
      setBusy(true);
      try {
        const c = await onCreateCollection(newCollection.trim());
        targetCollection = c.id;
      } finally { setBusy(false); }
    }
    onSubmit({ name: name.trim(), collectionId: targetCollection, folderId: creating ? null : folderId || null });
  };

  return (
    <Modal title="Save request" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Request name</span>
          <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Collection</span>
          <select value={creating ? '__new__' : collectionId} onChange={(e) => { setCollectionId(e.target.value); setFolderId(''); }}>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ New collection…</option>
          </select>
        </label>
        {creating ? (
          <label className="field">
            <span>New collection name</span>
            <input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="e.g. Billing API" />
          </label>
        ) : folderOptions.length > 0 ? (
          <label className="field">
            <span>Folder</span>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">(collection root)</option>
              {folderOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !name.trim() || (creating && !newCollection.trim())}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function flattenFolders(collection: Collection): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    for (const f of collection.folders.filter((x) => x.parentId === parentId)) {
      out.push({ id: f.id, label: prefix + f.name });
      walk(f.id, prefix + f.name + ' / ');
    }
  };
  walk(null, '');
  return out;
}
