import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { RoomIcon } from './RoomIcon';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Render inside the table instead of relying on a browser PDF plug-in. */
export default function PdfReader({ url, name }: { url: string; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    setPdf(null); setPage(1); setZoom(1); setError(''); setLoading(true);
    const task = getDocument({ url, withCredentials: true });
    void task.promise.then(document => { if (active) setPdf(document); }).catch(e => { if (active) { setError(e.message || 'Could not open this PDF.'); setLoading(false); } });
    return () => { active = false; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(120, entry.contentRect.width - 14)); });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true, render: RenderTask | undefined;
    setLoading(true); setText('');
    void pdf.getPage(page).then(async documentPage => {
      if (!active || !canvas.current) return;
      const base = documentPage.getViewport({ scale: 1 });
      const viewport = documentPage.getViewport({ scale: width / base.width * zoom });
      const outputScale = Math.min(2, window.devicePixelRatio || 1);
      const target = canvas.current;
      target.width = Math.ceil(viewport.width * outputScale); target.height = Math.ceil(viewport.height * outputScale);
      target.style.width = `${Math.ceil(viewport.width)}px`; target.style.height = `${Math.ceil(viewport.height)}px`;
      render = documentPage.render({ canvas: target, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] });
      await render.promise;
      if (!active) return;
      setLoading(false);
      const content = await documentPage.getTextContent();
      if (active) setText(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }).catch(e => { if (active && e.name !== 'RenderingCancelledException') { setError(e.message || 'Could not render this page.'); setLoading(false); } });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, width, zoom]);

  return <div className="room-pdf-app"><div className="room-pdf-controls" aria-label="PDF page controls">
    <button type="button" aria-label="Previous PDF page" disabled={!pdf || page <= 1} onClick={() => setPage(n => n - 1)}><RoomIcon name="up" size={17} /></button>
    <span>Page {page} / {pdf?.numPages ?? '…'}</span>
    <button type="button" aria-label="Next PDF page" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(n => n + 1)}><RoomIcon name="down" size={17} /></button>
    <button type="button" aria-label="Zoom PDF out" disabled={zoom <= 1} onClick={() => setZoom(n => Math.max(1, n - .25))}><RoomIcon name="minus" size={16} /></button>
    <button type="button" aria-label="Fit PDF to panel" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
    <button type="button" aria-label="Zoom PDF in" disabled={zoom >= 3} onClick={() => setZoom(n => Math.min(3, n + .25))}><RoomIcon name="plus" size={16} /></button>
  </div>
    {loading && <p role="status" className="room-muted">Loading page…</p>}
    {error && <p role="alert">{error}</p>}
    <div ref={host} className="room-pdf-page"><canvas ref={canvas} role="img" aria-label={`${name}, page ${page}`} /></div>
    {text && <details className="room-pdf-text"><summary>Read page as text</summary><p>{text}</p></details>}
  </div>;
}
