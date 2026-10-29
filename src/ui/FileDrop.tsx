import { useRef, useState } from 'react';

export interface FileDropProps { busy: boolean; onFile: (file: File) => void; onSample: () => void }
export function FileDrop({ busy, onFile, onSample }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <section className={`panel file-drop ${dragging ? 'is-dragging' : ''}`} aria-labelledby="file-title"
    onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
    onDragLeave={() => setDragging(false)} onDrop={(event) => {
      event.preventDefault(); setDragging(false);
      const file = event.dataTransfer.files[0]; if (file && !busy) onFile(file);
    }}>
    <span className="eyebrow">01 / Start with your file</span>
    <h2 id="file-title">A cleaner table. Every change reviewed.</h2>
    <p>Drop a CSV or TSV here. Your original stays on this device.</p>
    <p className="muted">Up to 5 MB · 20,000 rows · 60 columns</p>
    <div className="actions"><button className="primary" disabled={busy} onClick={() => input.current?.click()}>Choose CSV or TSV</button>
      <button disabled={busy} onClick={onSample}>Load sample: orders-demo.csv</button></div>
    <input ref={input} className="visually-hidden" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-label="CSV or TSV file" disabled={busy}
      onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onFile(file); event.currentTarget.value = ''; }}/>
  </section>;
}
