import { useEffect, useId, useRef, useState } from 'react';
import {
  burnMomentum, DEBILITIES, initiativeLabelFor, maxMomentum, MOMENTUM_MAX, MOMENTUM_MIN, resetMomentum, setDebility, setInitiative,
  sufferMomentum, sufferSupply, SUPPLY_MAX, takeMomentum, takeSupply, turnTheTide, type DebilityId, type Initiative,
} from '@daggery/shared';
import { Icon } from '../components/Icon';
import { signed, useMomentum } from './useMomentum';
import './momentum.css';

const SPAN = MOMENTUM_MAX - MOMENTUM_MIN;
const place = (value: number) => `${((value - MOMENTUM_MIN) / SPAN) * 100}%`;

/** Momentum in the top bar. Click it for Supply, Initiative, Debilities and Experience. */
export function MomentumTracker() {
  const { tracker, update } = useMomentum();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState<'up' | 'down' | null>(null);
  const previous = useRef(tracker.value);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const max = maxMomentum(tracker.debilities), reset = resetMomentum(tracker.debilities);

  useEffect(() => {
    if (tracker.value === previous.current) return;
    setPulse(tracker.value > previous.current ? 'up' : 'down');
    previous.current = tracker.value;
    const timer = window.setTimeout(() => setPulse(null), 700);
    return () => window.clearTimeout(timer);
  }, [tracker.value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const atFloor = tracker.value === MOMENTUM_MIN;
  const fighting = tracker.initiative !== null;
  const summary = `Momentum ${signed(tracker.value)}. ${fighting ? `Initiative: ${tracker.initiative === 'hero' ? 'you' : 'your foe'}. ` : ''}Supply ${tracker.supply}.`;

  const choose = (initiative: Initiative) => update(current => setInitiative(current, initiative));
  const loseMomentum = () => update(current => sufferMomentum(current, 1).tracker);

  return (
    <div className="momentum-tracker" ref={rootRef} data-negative={tracker.value < 0 || undefined} data-pulse={pulse ?? undefined} data-initiative={tracker.initiative ?? undefined}>
      <button type="button" className="momentum-chip" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId} aria-label={summary} title={summary}>
        <span className="momentum-chip-label">Momentum</span>
        <span className="momentum-meter" aria-hidden="true">
          <i className="is-zero" style={{ left: place(0) }} />
          <i className="is-reset" style={{ left: place(reset) }} />
          <i className="is-max" style={{ left: place(max) }} />
          <b style={{ left: place(tracker.value) }} />
        </span>
        <strong className="momentum-count" aria-live="polite">{signed(tracker.value)}</strong>
        {fighting && <span className="momentum-initiative"><Icon name="combat" />{tracker.initiative === 'hero' ? 'You' : 'Foe'}</span>}
      </button>
      {open && (
        <div className="momentum-panel" id={panelId} role="group" aria-label="Momentum and trackers">
          <div className="momentum-row momentum-main">
            <button type="button" onClick={loseMomentum} aria-label="Suffer 1 momentum" title="Suffer −1 momentum"><Icon name="minus" /></button>
            <output aria-label={`Momentum: ${signed(tracker.value)}`}><strong>{signed(tracker.value)}</strong><small>max {signed(max)} · reset {signed(reset)}</small></output>
            <button type="button" onClick={() => update(current => takeMomentum(current, 1))} disabled={tracker.value >= max} aria-label="Take 1 momentum" title="Take +1 momentum"><Icon name="plus" /></button>
          </div>
          <button type="button" className="momentum-burn" onClick={() => update(burnMomentum)} disabled={tracker.value <= reset}>
            Burn Momentum<small>to {signed(reset)}: improve a roll by one step</small>
          </button>
          {atFloor && <p className="momentum-warning" role="status">Momentum is at −6. Any more loss is a <i>Face a Setback</i>.</p>}

          <section aria-labelledby={`${panelId}-supply`}>
            <h4 id={`${panelId}-supply`}>Supply</h4>
            <div className="momentum-row">
              <button type="button" onClick={() => update(current => sufferSupply(current, 1).tracker)} disabled={tracker.supply === 0} aria-label="Suffer 1 supply"><Icon name="minus" /></button>
              <span className="momentum-supply" role="img" aria-label={`Supply ${tracker.supply} of ${SUPPLY_MAX}`}>
                {Array.from({ length: SUPPLY_MAX }, (_, index) => <i key={index} className={index < tracker.supply ? 'is-filled' : undefined} />)}
              </span>
              <button type="button" onClick={() => update(current => takeSupply(current, 1))} disabled={tracker.supply >= SUPPLY_MAX} aria-label="Take 1 supply"><Icon name="plus" /></button>
            </div>
            {tracker.supply === 0 && <p className="momentum-note">Out of Supply: each further loss costs Hit Points, Stress or Momentum.</p>}
          </section>

          <section aria-labelledby={`${panelId}-initiative`}>
            <h4 id={`${panelId}-initiative`}>Initiative</h4>
            <div className="momentum-segments" role="group" aria-label="Who has initiative">
              {([[null, 'No fight'], ['hero', 'You'], ['foe', 'Foe']] as const).map(([value, label]) => (
                <button key={label} type="button" aria-pressed={tracker.initiative === value} onClick={() => choose(value)}>{label}</button>
              ))}
            </div>
            <button type="button" className="momentum-tide" onClick={() => update(turnTheTide)} disabled={!fighting || tracker.tideTurned}>
              Turn the Tide<small>{tracker.tideTurned ? 'used this fight' : 'once per fight: take initiative'}</small>
            </button>
            {fighting && <p className="momentum-note">{initiativeLabelFor(tracker.initiative)}</p>}
          </section>

          <section aria-labelledby={`${panelId}-debilities`}>
            <h4 id={`${panelId}-debilities`}>Debilities</h4>
            <div className="momentum-debilities">
              {DEBILITIES.map(item => (
                <button key={item.id} type="button" data-group={item.group} aria-pressed={tracker.debilities.includes(item.id)} title={item.hint}
                  onClick={() => update(current => setDebility(current, item.id as DebilityId, !current.debilities.includes(item.id)))}>{item.label}</button>
              ))}
            </div>
            <p className="momentum-note">Each one lowers the most Momentum you can hold, and the reset.</p>
          </section>

          <section aria-labelledby={`${panelId}-experience`}>
            <h4 id={`${panelId}-experience`}>Experience</h4>
            <div className="momentum-row">
              <button type="button" onClick={() => update(current => ({ ...current, experience: Math.max(0, current.experience - 1) }))} disabled={tracker.experience === 0} aria-label="Spend 1 experience"><Icon name="minus" /></button>
              <output aria-label={`Experience: ${tracker.experience}`}><strong>{tracker.experience}</strong></output>
              <button type="button" onClick={() => update(current => ({ ...current, experience: Math.min(999, current.experience + 1) }))} aria-label="Mark 1 experience"><Icon name="plus" /></button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
