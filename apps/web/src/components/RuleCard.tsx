import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The original card is primary; structured text remains available to readers and on image failure. */
export function RuleCard({ src, title, children, selected = false, onSelect }: {
  src?: string | null;
  title: string;
  children: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const unavailable = !src || failedSrc === src;

  useEffect(() => {
    if (zoomed) dialog.current?.showModal();
  }, [zoomed]);

  return (
    <div className="min-w-0">
      {!unavailable && (
        <div className="group relative mx-auto w-full max-w-[360px]">
          <button type="button" onClick={onSelect ?? (() => setZoomed(true))}
            aria-label={`${onSelect ? 'Select' : 'Open card'} ${title}`}
            aria-pressed={onSelect ? selected : undefined}
            className={`block w-full rounded-lg focus-visible:outline-2 focus-visible:outline-accent-400 ${selected ? 'ring-4 ring-accent-400 ring-offset-2 ring-offset-slate-950' : ''}`}>
            <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} className="block h-auto w-full rounded-lg" />
          </button>
          {onSelect && <button type="button" onClick={() => setZoomed(true)} aria-label={`Open card ${title}`}
            className="absolute right-2 top-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-raised)] px-2 py-1 text-sm text-[var(--ds-ink)] focus-visible:outline-2 focus-visible:outline-accent-400" title="Open card">⤢</button>}
        </div>
      )}
      {unavailable ? (
        <div className="text-sm text-slate-300">
          {onSelect ? <button type="button" onClick={onSelect} aria-pressed={selected} className={`mb-2 font-semibold ${selected ? 'text-accent-400' : ''}`}>{title}{selected ? ' ✓' : ''}</button> : <p className="mb-2 font-semibold">{title}</p>}
          <p className="mb-2 text-xs text-slate-400">Image unavailable. Content as text:</p>
          {children}
        </div>
      ) : <div className="sr-only">{children}</div>}
      {zoomed && src && (
        <dialog ref={dialog} onClose={() => setZoomed(false)} onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }} className="m-auto max-h-[95vh] max-w-[95vw] overflow-auto rounded-lg bg-slate-950 p-3 text-slate-100 backdrop:bg-black/80">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-sm font-semibold">{title}</span>
            <button type="button" onClick={() => dialog.current?.close()} className="rounded border border-slate-600 px-3 py-1 text-sm">Close</button>
          </div>
          <img src={src} alt={`Expanded card: ${title}`} className="mx-auto h-auto max-h-[80vh] max-w-full" />
        </dialog>
      )}
    </div>
  );
}

export function CardText({ lines }: { lines: string[] }) {
  return <div className="space-y-2 whitespace-pre-line text-sm leading-relaxed">{lines.map((line, index) => <p key={index}>{line}</p>)}</div>;
}
