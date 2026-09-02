import type { KeyValue } from '../types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  secretValues?: boolean;
}

/** Postman-style key/value table with a phantom trailing row that becomes real when typed into. */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', secretValues }: Props) {
  const update = (i: number, patch: Partial<KeyValue>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const add = (patch: Partial<KeyValue>) => onChange([...rows, { key: '', value: '', enabled: true, ...patch }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <table className="kv">
      <thead>
        <tr>
          <th style={{ width: 28 }}></th>
          <th>{keyPlaceholder}</th>
          <th>{valuePlaceholder}</th>
          <th style={{ width: 28 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.enabled ? '' : 'disabled'}>
            <td><input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></td>
            <td><input value={r.key} placeholder={keyPlaceholder} onChange={(e) => update(i, { key: e.target.value })} spellCheck={false} /></td>
            <td><input value={r.value} placeholder={valuePlaceholder} type={secretValues ? 'password' : 'text'} onChange={(e) => update(i, { value: e.target.value })} spellCheck={false} /></td>
            <td><button className="icon" title="Remove" onClick={() => remove(i)}>×</button></td>
          </tr>
        ))}
        <tr className="phantom">
          <td></td>
          <td><input value="" placeholder={keyPlaceholder} onChange={(e) => add({ key: e.target.value })} spellCheck={false} /></td>
          <td><input value="" placeholder={valuePlaceholder} onChange={(e) => add({ value: e.target.value })} spellCheck={false} /></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );
}
