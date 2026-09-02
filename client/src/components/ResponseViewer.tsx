import { useMemo, useState } from 'react';
import type { SendResult } from '../types';
import { copyText, formatBytes, formatTime, prettyJson, statusClass } from '../lib/util';

type View = 'body' | 'headers' | 'sent';

export function ResponseViewer({ result, sending, onToast }: { result: SendResult | null; sending: boolean; onToast: (m: string) => void }) {
  const [view, setView] = useState<View>('body');
  const [pretty, setPretty] = useState(true);
  const [wrap, setWrap] = useState(true);

  const isJson = !!result?.contentType && /json/i.test(result.contentType);
  const isImage = !!result?.contentType && /^image\//i.test(result.contentType) && result.bodyEncoding === 'base64';
  const prettyBody = useMemo(() => (result?.body && result.bodyEncoding !== 'base64' && (isJson || /^[\[{]/.test(result.body.trimStart())) ? prettyJson(result.body) : null), [result, isJson]);
  const shownBody = pretty && prettyBody !== null ? prettyBody : result?.body ?? '';

  if (sending) return <div className="response"><div className="response-empty"><div className="spinner" /> Sending…</div></div>;
  if (!result) return <div className="response"><div className="response-empty">Send a request to see the response here.<br /><kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends, <kbd>Ctrl</kbd> + <kbd>S</kbd> saves.</div></div>;

  return (
    <div className="response">
      <div className="response-head">
        {result.ok ? (
          <>
            <span className={`status-pill ${statusClass(result.status)}`}>{result.status} {result.statusText}</span>
            <span className="meta">{formatTime(result.time)}</span>
            <span className="meta">{formatBytes(result.size)}</span>
            {result.redirected && <span className="meta" title={result.finalUrl}>redirected</span>}
          </>
        ) : (
          <>
            <span className="status-pill err">Error</span>
            <span className="meta">{formatTime(result.time)}</span>
          </>
        )}
        <div className="spacer" />
        <div className="section-tabs compact">
          <button className={view === 'body' ? 'active' : ''} onClick={() => setView('body')}>Body</button>
          <button className={view === 'headers' ? 'active' : ''} onClick={() => setView('headers')}>Headers{result.headers ? <sup>{result.headers.length}</sup> : null}</button>
          <button className={view === 'sent' ? 'active' : ''} onClick={() => setView('sent')}>Request sent</button>
        </div>
      </div>

      {result.warnings?.length > 0 && (
        <div className="warnings">{result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
      )}

      {!result.ok && (
        <div className="response-body error-body">
          <strong>Could not complete the request.</strong>
          <pre>{result.error}</pre>
          <p className="hint">Check the URL, your network, and that the target server is reachable from the mailman server.</p>
        </div>
      )}

      {result.ok && view === 'body' && (
        <div className="response-body">
          <div className="body-toolbar">
            {prettyBody !== null && (
              <label><input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> Pretty</label>
            )}
            <label><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap</label>
            <span className="spacer" />
            {result.body && result.bodyEncoding !== 'base64' && (
              <button className="small" onClick={async () => onToast((await copyText(shownBody)) ? 'Copied response body' : 'Copy failed')}>Copy</button>
            )}
          </div>
          {isImage ? (
            <div className="image-body"><img src={`data:${result.contentType};base64,${result.body}`} alt="response" /></div>
          ) : result.bodyEncoding === 'base64' ? (
            <div className="hint">Binary response ({result.contentType || 'unknown type'}, {formatBytes(result.size)}). Not displayed.</div>
          ) : (
            <pre className={`code-view ${wrap ? 'wrap' : ''}`}>{shownBody || <span className="hint">(empty body)</span>}</pre>
          )}
        </div>
      )}

      {result.ok && view === 'headers' && (
        <div className="response-body">
          <table className="headers-table">
            <tbody>
              {(result.headers ?? []).map(([k, v], i) => <tr key={i}><td className="hk">{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {view === 'sent' && (
        <div className="response-body">
          <pre className="code-view wrap">{`${result.sent.method} ${result.sent.url}\n${result.sent.headers.map(([k, v]) => `${k}: ${k.toLowerCase() === 'authorization' ? '••••••' : v}`).join('\n')}${result.sent.body ? `\n\n${result.sent.body}` : ''}`}</pre>
        </div>
      )}
    </div>
  );
}
