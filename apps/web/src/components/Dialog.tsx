import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Native modal semantics provide focus trapping, Escape, and focus restoration. */
export function Dialog({ open, onClose, title, children, className = '' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return createPortal(<dialog ref={ref} className={`daggery-dialog ${className}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="daggery-dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="daggery-theme" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><Icon name="close" /></button></header>
    <div className="daggery-dialog-body">{open ? children : null}</div>
  </dialog>, document.body);
}
