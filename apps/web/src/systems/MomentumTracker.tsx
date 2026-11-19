import { useId } from 'react';
import {
  burnMomentum, DEBILITIES, initiativeLabelFor, maxMomentum, MOMENTUM_MAX, MOMENTUM_MIN, resetMomentum, setDebility, setInitiative,
  setMomentum, sufferMomentum, sufferSupply, SUPPLY_MAX, takeMomentum, takeSupply, turnTheTide, type DebilityId, type Initiative,
} from '@daggery/shared';
import { Icon } from '../components/Icon';
import { signed, useMomentum } from './useMomentum';
import { usePulse, useTrackerPanel } from './useTrackerPanel';
import './trackers.css';

const RUNGS = Array.from({ length: MOMENTUM_MAX - MOMENTUM_MIN + 1 }, (_, index) => MOMENTUM_MIN + index);
const GROUPS = [
  { id: 'condition', label: 'Conditions' },
  { id: 'bane', label: 'Banes' },
  { id: 'burden', label: 'Burdens' },
] as const;

/** Momentum in the top bar: your side of the table. Click it for the ladder, Supply, Initiative and Debilities. */
export function MomentumTracker() {
  const { tracker, update } = useMomentum();
  const { open, setOpen, rootRef } = useTrackerPanel();
  const pulse = usePulse(tracker.value);
  const panelId = useId();
  const max = maxMomentum(tracker.debilities), reset = resetMomentum(tracker.debilities);
  const fighting = tracker.initiative !== null;
  const atFloor = tracker.value === MOMENTUM_MIN;
  const summary = `Momentum ${signed(tracker.value)}. ${fighting ? `Initiative: ${tracker.initiative === 'hero' ? 'you' : 'your foe'}. ` : ''}Supply ${tracker.supply}.`;

  const rungClass = (value: number) => [
    value < 0 ? 'is-neg' : 'is-pos', value === 0 && 'is-zero', value > max && 'is-blocked', value === reset && 'is-reset',
    value === tracker.value && 'is-current',
    ((value > 0 && value <= tracker.value) || (value < 0 && value >= tracker.value)) && 'is-filled',
  ].filter(Boolean).join(' ');

  const choose = (initiative: Initiative) => update(current => setInitiative(current, initiative));

  return (
    <div className="tracker is-momentum" ref={rootRef} data-negative={tracker.value < 0 || undefined} data-pulse={pulse ?? undefined} data-initiative={tracker.initiative ?? undefined}>
      <button type="button" className="tracker-chip" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId} aria-label={summary} title={summary}>
        <Icon name="spark" />
        <span className="tracker-label">Momentum</span>
        <span className="tracker-meter" aria-hidden="true">
          {RUNGS.map(value => <i key={value} className={[
            value === 0 && 'is-zero', value > max && 'is-blocked', value === max && 'is-cap',
            value > 0 && value <= tracker.value && 'is-pos', value < 0 && value >= tracker.value && 'is-neg',
          ].filter(Boolean).join(' ')} />)}
        </span>
        <strong className="tracker-count" aria-live="polite">{signed(tracker.value)}</strong>
        {fighting && <span className="tracker-badge"><Icon name={tracker.initiative === 'hero' ? 'combat' : 'adversary'} />{tracker.initiative === 'hero' ? 'You' : 'Foe'}</span>}
      </button>

      {open && (
        <div className="tracker-panel" id={panelId} role="group" aria-label="Momentum and trackers">
          <section className="tracker-card is-hero" aria-label="Momentum">
            <h4><Icon name="spark" />Momentum<small>max {signed(max)} · reset {signed(reset)}</small></h4>
            <div className="tracker-dial">
              <button type="button" className="tracker-step" onClick={() => update(current => sufferMomentum(current, 1).tracker)} aria-label="Suffer 1 momentum" title="Suffer −1 momentum"><Icon name="minus" /></button>
              <output aria-label={`Momentum: ${signed(tracker.value)}`}><strong>{signed(tracker.value)}</strong><small>{atFloor ? 'at the floor' : tracker.value >= max ? 'at your maximum' : 'tap a rung to set it'}</small></output>
              <button type="button" className="tracker-step" onClick={() => update(current => takeMomentum(current, 1))} disabled={tracker.value >= max} aria-label="Take 1 momentum" title="Take +1 momentum"><Icon name="plus" /></button>
            </div>
            <div className="tracker-ladder" role="group" aria-label="Set Momentum">
              {RUNGS.map(value => (
                <button key={value} type="button" className={rungClass(value)} disabled={value > max} aria-pressed={value === tracker.value}
                  aria-label={`Set Momentum to ${signed(value)}`} onClick={() => update(current => setMomentum(current, value))}>{value === 0 ? '0' : signed(value)}</button>
              ))}
            </div>
            <div className="tracker-ladder-key" aria-hidden="true"><span>−6 floor</span><span>reset {signed(reset)}</span><span>+10 top</span></div>
            <button type="button" className="tracker-action" onClick={() => update(burnMomentum)} disabled={tracker.value <= reset}>
              <Icon name="torch" />
              <strong>Burn Momentum</strong>
              <small>{tracker.value <= reset ? `Needs more than ${signed(reset)}` : `Reset to ${signed(reset)}. Ignore the Fear die: improve a roll one step.`}</small>
            </button>
            {atFloor && <p className="tracker-warning" role="status"><Icon name="stress" /><span>Momentum is at −6. Any more loss is a <i>Face a Setback</i>.</span></p>}
          </section>

          <section className="tracker-card" aria-label="Supply">
            <h4><Icon name="backpack" />Supply<small>{tracker.supply === 0 ? 'Unprepared' : `${tracker.supply} of ${SUPPLY_MAX}`}</small></h4>
            <div className="tracker-row">
              <div className="tracker-pips" role="group" aria-label={`Supply ${tracker.supply} of ${SUPPLY_MAX}`}>
                {Array.from({ length: SUPPLY_MAX }, (_, index) => (
                  <button key={index} type="button" className={index < tracker.supply ? 'is-on' : undefined} aria-label={`Set Supply to ${index + 1}`}
                    onClick={() => update(current => index + 1 === current.supply ? sufferSupply(current, 1).tracker : index + 1 > current.supply ? takeSupply(current, index + 1 - current.supply) : sufferSupply(current, current.supply - index - 1).tracker)}>
                    <Icon name="backpack" />
                  </button>
                ))}
              </div>
            </div>
            {tracker.supply === 0 && <p className="tracker-note">Out of Supply: each further loss costs Hit Points, Stress or Momentum.</p>}
          </section>

          <section className="tracker-card" aria-label="Initiative">
            <h4><Icon name="combat" />Initiative</h4>
            <div className="tracker-segments" role="group" aria-label="Who has initiative">
              <button type="button" aria-pressed={tracker.initiative === null} onClick={() => choose(null)}>No fight</button>
              <button type="button" className="is-hero" aria-pressed={tracker.initiative === 'hero'} onClick={() => choose('hero')}><Icon name="shield" />You</button>
              <button type="button" className="is-foe" aria-pressed={tracker.initiative === 'foe'} onClick={() => choose('foe')}><Icon name="adversary" />Foe</button>
            </div>
            {fighting && <p className={`tracker-state${tracker.initiative === 'foe' ? ' is-foe' : ''}`} role="status"><Icon name={tracker.initiative === 'hero' ? 'combat' : 'adversary'} /><span>{initiativeLabelFor(tracker.initiative)}</span></p>}
            <button type="button" className="tracker-action" onClick={() => update(turnTheTide)} disabled={!fighting || tracker.tideTurned}>
              <Icon name="rotate" />
              <strong>Turn the Tide</strong>
              <small>{tracker.tideTurned ? 'Used this fight' : !fighting ? 'Start a fight first' : 'Once per fight: steal initiative'}</small>
            </button>
          </section>

          <section className="tracker-card" aria-label="Debilities">
            <h4><Icon name="stress" />Debilities<small>{tracker.debilities.length === 0 ? 'none' : `${tracker.debilities.length} marked`}</small></h4>
            <div className="tracker-debs">
              {GROUPS.map(group => (
                <div key={group.id}>
                  <h5>{group.label}</h5>
                  <div className="chips">
                    {DEBILITIES.filter(item => item.group === group.id).map(item => (
                      <button key={item.id} type="button" data-group={item.group} aria-pressed={tracker.debilities.includes(item.id)} title={item.hint}
                        onClick={() => update(current => setDebility(current, item.id as DebilityId, !current.debilities.includes(item.id)))}>{item.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="tracker-note">Each one lowers the most Momentum you can hold, and the reset.</p>
          </section>

          <section className="tracker-card" aria-label="Experience">
            <h4><Icon name="gem" />Experience</h4>
            <div className="tracker-row">
              <p className="tracker-note">Spend 3 to add an asset, 2 to upgrade one.</p>
              <div className="tracker-mini">
                <button type="button" onClick={() => update(current => ({ ...current, experience: Math.max(0, current.experience - 1) }))} disabled={tracker.experience === 0} aria-label="Spend 1 experience"><Icon name="minus" /></button>
                <strong aria-label={`Experience: ${tracker.experience}`}>{tracker.experience}</strong>
                <button type="button" onClick={() => update(current => ({ ...current, experience: Math.min(999, current.experience + 1) }))} aria-label="Mark 1 experience"><Icon name="plus" /></button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
