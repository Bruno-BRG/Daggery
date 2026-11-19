import { useId } from 'react';
import { DUALITY_MAX_FEAR } from '@daggery/shared';
import { Icon } from '../components/Icon';
import { getActiveCampaign } from '../campaign-context';
import { addFear, useDoc } from '../sync/store';
import { usePulse, useTrackerPanel } from './useTrackerPanel';
import './trackers.css';

interface FearDoc { kind: 'fear'; value: number }
const RUNGS = Array.from({ length: DUALITY_MAX_FEAR + 1 }, (_, index) => index);

/** The Fear pool, always in view: the world's side of the table. Click it for the controls. */
export function FearTracker() {
  const campaign = getActiveCampaign();
  const [doc] = useDoc<FearDoc>('combat', 'fear');
  const fear = Math.min(DUALITY_MAX_FEAR, Math.max(0, Math.trunc(Number(doc?.value) || 0)));
  const threshold = Number(campaign.configuration.options.fearThreshold) || 0;
  const isGm = campaign.role === 'gm';
  const { open, setOpen, rootRef } = useTrackerPanel();
  const pulse = usePulse(fear);
  const panelId = useId();

  const active = threshold > 0 && fear >= threshold;
  const status = fear === 0 ? 'No Fear. The world cannot act.'
    : active ? `At or above ${threshold}: the world can act.` : `${threshold - fear} more until the world can act.`;
  /** A tap sets the pool by sending the difference. Only the GM may take Fear away. */
  const setTo = (value: number) => { const delta = value - fear; if (delta !== 0 && (isGm || delta > 0)) addFear(delta); };

  return (
    <div className="tracker is-fear" ref={rootRef} data-active={active || undefined} data-pulse={pulse ?? undefined}>
      <button type="button" className="tracker-chip" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        aria-label={`Fear ${fear} of ${DUALITY_MAX_FEAR}. ${status}`} title={`Fear ${fear} / ${DUALITY_MAX_FEAR}`}>
        <Icon name="adversary" />
        <span className="tracker-label">Fear</span>
        <span className="tracker-meter" aria-hidden="true">
          {RUNGS.slice(1).map(value => <i key={value} className={[value <= fear && 'is-pos', value === threshold && 'is-threshold'].filter(Boolean).join(' ')} />)}
        </span>
        <strong className="tracker-count" aria-live="polite">{fear}</strong>
      </button>
      {open && (
        <div className="tracker-panel" id={panelId} role="group" aria-label="Fear pool">
          <section className="tracker-card is-hero" aria-label="Fear">
            <h4><Icon name="adversary" />Fear<small>the world acts at {threshold}+</small></h4>
            <div className="tracker-dial">
              <button type="button" className="tracker-step" onClick={() => addFear(-1)} disabled={!isGm || fear === 0} aria-label="Remove 1 Fear" title={isGm ? 'Remove 1 Fear' : 'Only the GM can remove Fear'}><Icon name="minus" /></button>
              <output aria-label={`Fear: ${fear}`}><strong>{fear}</strong><small>of {DUALITY_MAX_FEAR}</small></output>
              <button type="button" className="tracker-step" onClick={() => addFear(1)} disabled={fear >= DUALITY_MAX_FEAR} aria-label="Add 1 Fear" title="Add 1 Fear"><Icon name="plus" /></button>
            </div>
            <div className="tracker-ladder" role="group" aria-label="Set Fear">
              {RUNGS.map(value => (
                <button key={value} type="button" className={['is-pos', value <= fear && value > 0 && 'is-filled', value === fear && 'is-current', value === threshold && 'is-reset'].filter(Boolean).join(' ')}
                  disabled={!isGm && value < fear} aria-pressed={value === fear} aria-label={`Set Fear to ${value}`} onClick={() => setTo(value)}>{value}</button>
              ))}
            </div>
            <div className="tracker-ladder-key" aria-hidden="true"><span>0</span><span>acts at {threshold}</span><span>{DUALITY_MAX_FEAR}</span></div>
            <p className={`tracker-state${active ? '' : ''}`} role="status"><Icon name={active ? 'stress' : 'shield'} /><span>{status}</span></p>
            <p className="tracker-note">A roll made with Fear adds 1 automatically.</p>
          </section>
        </div>
      )}
    </div>
  );
}
