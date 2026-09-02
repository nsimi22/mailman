import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

/** A tiny "…" dropdown menu. */
export function Menu({ items, label = '⋯', title = 'More', children }: { items: MenuItem[]; label?: ReactNode; title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`menu ${open ? 'open' : ''}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon" title={title} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{children ?? label}</button>
      {open && (
        <div className="menu-pop">
          {items.map((it, i) => it.separator
            ? <div key={i} className="menu-sep" />
            : <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>)}
        </div>
      )}
    </div>
  );
}
