import { useEffect, useRef, useState } from 'react';

/** Open and close state for a tracker's panel: it closes on a click outside or on Escape. */
export function useTrackerPanel() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return { open, setOpen, rootRef };
}

/** A short flash class when a number goes up or down, whoever changed it. */
export function usePulse(value: number) {
  const [pulse, setPulse] = useState<'up' | 'down' | null>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (value === previous.current) return;
    setPulse(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const timer = window.setTimeout(() => setPulse(null), 750);
    return () => window.clearTimeout(timer);
  }, [value]);
  return pulse;
}
