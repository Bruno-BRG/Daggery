import { useEffect, useId, useRef, useState } from 'react';
import { DUALITY_MAX_FEAR } from '@daggery/shared';
import { Icon } from '../components/Icon';
import { getActiveCampaign } from '../campaign-context';
import { addFear, useDoc } from '../sync/store';
import './fear.css';

interface FearDoc { kind: 'fear'; value: number }

/** The Fear pool, always in view. Click it for the controls. Everyone at the table sees the same number. */
export function FearTracker() {
  const campaign = getActiveCampaign();
  const [doc] = useDoc<FearDoc>('combat', 'fear');
  const fear = Math.min(DUALITY_MAX_FEAR, Math.max(0, Math.trunc(Number(doc?.value) || 0)));
  const threshold = Number(campaign.configuration.options.fearThreshold) || 0;
  const isGm = campaign.role === 'gm';
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState<'up' | 'down' | null>(null);
  const previous = useRef(fear);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A short flash when the pool changes, whoever changed it.
  useEffect(() => {
    if (fear === previous.current) return;
    setPulse(fear > previous.current ? 'up' : 'down');
    previous.current = fear;
    const timer = window.setTimeout(() => setPulse(null), 700);
    return () => window.clearTimeout(timer);
  }, [fear]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const active = threshold > 0 && fear >= threshold;
  const status = fear === 0
    ? 'No Fear. The world cannot act.'
    : active
      ? `At or above ${threshold}: the world can act.`
      : `${threshold - fear} more until the world can act.`;

  return (
    <div className="fear-tracker" ref={rootRef} data-active={active || undefined} data-pulse={pulse ?? undefined}>
      <button
        type="button"
        className="fear-chip"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Fear ${fear} of ${DUALITY_MAX_FEAR}. ${status}`}
        title={`Fear ${fear} / ${DUALITY_MAX_FEAR}`}
      >
        <span className="fear-chip-label">Fear</span>
        <span className="fear-pips" aria-hidden="true">
          {Array.from({ length: DUALITY_MAX_FEAR }, (_, index) => (
            <i key={index} className={index < fear ? 'is-filled' : undefined} data-threshold={index + 1 === threshold || undefined} />
          ))}
        </span>
        <strong className="fear-count" aria-live="polite">{fear}</strong>
      </button>
      {open && (
        <div className="fear-panel" id={panelId} role="group" aria-label="Fear pool">
          <div className="fear-panel-value">
            <button type="button" onClick={() => addFear(-1)} disabled={!isGm || fear === 0} aria-label="Remove 1 Fear" title={isGm ? 'Remove 1 Fear' : 'Only the GM can remove Fear'}><Icon name="minus" /></button>
            <output aria-label={`Fear: ${fear}`}><strong>{fear}</strong><small>of {DUALITY_MAX_FEAR}</small></output>
            <button type="button" onClick={() => addFear(1)} disabled={fear >= DUALITY_MAX_FEAR} aria-label="Add 1 Fear" title="Add 1 Fear"><Icon name="plus" /></button>
          </div>
          <p className="fear-panel-status">{status}</p>
          <p className="fear-panel-note">A roll made with Fear adds 1 automatically. The world acts at {threshold} Fear or more.</p>
        </div>
      )}
    </div>
  );
}
