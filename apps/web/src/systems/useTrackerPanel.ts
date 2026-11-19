import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

const PANEL_WIDTH = 352;
const EDGE = 10;

/**
 * Open and close state for a tracker's panel. The panel is drawn outside the top bar (in a portal), because
 * the bar clips what overflows it. `style` puts it just under the chip, kept inside the screen. It closes on
 * a click outside or on Escape.
 */
export function useTrackerPanel() {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const chip = rootRef.current?.querySelector('.tracker-chip')?.getBoundingClientRect();
    if (!chip) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
    const left = Math.max(EDGE, Math.min(chip.right - width, window.innerWidth - width - EDGE));
    setStyle({ top: chip.bottom + 10, left, width, maxHeight: Math.max(240, window.innerHeight - chip.bottom - 24) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  return { open, setOpen, rootRef, panelRef, style };
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
