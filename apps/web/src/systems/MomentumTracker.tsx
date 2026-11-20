import { useId } from 'react';
import { createPortal } from 'react-dom';
import {
  activeMomentum, burnMomentum, DEBILITIES, initiativeLabelFor, maxMomentum, MOMENTUM_MAX, MOMENTUM_MIN, resetMomentum, setInitiative,
  setMomentum, sufferMomentum, sufferSupply, SUPPLY_MAX, takeMomentum, takeSupply, turnTheTide, type Initiative,
} from '@daggery/shared';
import { Icon } from '../components/Icon';
import { FightMomentum } from './FightMomentum';
import { signed, useMomentum } from './useMomentum';
import { usePulse, useTrackerPanel } from './useTrackerPanel';
import './trackers.css';

const RUNGS = Array.from({ length: MOMENTUM_MAX - MOMENTUM_MIN + 1 }, (_, index) => MOMENTUM_MIN + index);

/** Momentum in the top bar: your side of the table. Click it for the ladder, Supply, Initiative and the Momentum of this fight. */
export function MomentumTracker() {
  const { tracker, update } = useMomentum();
  const now = activeMomentum(tracker);
  const { open, setOpen, rootRef, panelRef, style } = useTrackerPanel();
  const pulse = usePulse(now);
  const panelId = useId();
  const max = maxMomentum(tracker.debilities), reset = resetMomentum(tracker.debilities);
  const fighting = tracker.initiative !== null;
  const atFloor = now === MOMENTUM_MIN;
  const summary = `${tracker.fight ? 'Fight Momentum' : 'Momentum'} ${signed(now)}${tracker.fight ? `, campaign ${signed(tracker.value)}` : ''}. ${fighting ? `Initiative: ${tracker.initiative === 'hero' ? 'you' : 'your foe'}. ` : ''}Supply ${tracker.supply}.`;

  const rungClass = (value: number) => [
    value < 0 ? 'is-neg' : 'is-pos', value === 0 && 'is-zero', value > max && 'is-blocked', value === reset && 'is-reset',
    value === now && 'is-current',
    ((value > 0 && value <= now) || (value < 0 && value >= now)) && 'is-filled',
  ].filter(Boolean).join(' ');

  const choose = (initiative: Initiative) => update(current => setInitiative(current, initiative));

  return (
    <div className="tracker is-momentum" ref={rootRef} data-negative={now < 0 || undefined} data-pulse={pulse ?? undefined} data-initiative={tracker.initiative ?? undefined}>
      <button type="button" className="tracker-chip" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId} aria-label={summary} title={summary}>
        <Icon name="spark" />
        <span className="tracker-label">{fighting ? 'Fight' : 'Momentum'}</span>
        <span className="tracker-meter" aria-hidden="true">
          {RUNGS.map(value => <i key={value} className={[
            value === 0 && 'is-zero', value > max && 'is-blocked', value === max && 'is-cap',
            value > 0 && value <= now && 'is-pos', value < 0 && value >= now && 'is-neg',
          ].filter(Boolean).join(' ')} />)}
        </span>
        <strong className="tracker-count" aria-live="polite">{signed(now)}</strong>
        {fighting && <span className="tracker-badge"><Icon name={tracker.initiative === 'hero' ? 'combat' : 'adversary'} />{tracker.initiative === 'hero' ? 'You' : 'Foe'}</span>}
      </button>

      {open && createPortal(
        <div className="tracker is-momentum tracker-panel" id={panelId} ref={panelRef} style={style} role="group" aria-label="Momentum and trackers" data-negative={now < 0 || undefined}>
          <section className="tracker-card is-hero" aria-label="Momentum">
            <h4><Icon name={fighting ? 'combat' : 'spark'} />{fighting ? 'Fight Momentum' : 'Campaign Momentum'}<small>max {signed(max)} · reset {signed(reset)}</small></h4>
            {fighting && <p className="tracker-note">This fight has its own Momentum. Your campaign Momentum, <strong>{signed(tracker.value)}</strong>, waits and is not changed until the fight ends.</p>}
            <div className="tracker-dial">
              <button type="button" className="tracker-step" onClick={() => update(current => sufferMomentum(current, 1).tracker)} aria-label="Suffer 1 momentum" title="Suffer −1 momentum"><Icon name="minus" /></button>
              <output aria-label={`Momentum: ${signed(now)}`}><strong>{signed(now)}</strong><small>{atFloor ? 'at the floor' : now >= max ? 'at your maximum' : 'tap a rung to set it'}</small></output>
              <button type="button" className="tracker-step" onClick={() => update(current => takeMomentum(current, 1))} disabled={now >= max} aria-label="Take 1 momentum" title="Take +1 momentum"><Icon name="plus" /></button>
            </div>
            <div className="tracker-ladder" role="group" aria-label="Set Momentum">
              {RUNGS.map(value => (
                <button key={value} type="button" className={rungClass(value)} disabled={value > max} aria-pressed={value === now}
                  aria-label={`Set Momentum to ${signed(value)}`} onClick={() => update(current => setMomentum(current, value))}>{value === 0 ? '0' : signed(value)}</button>
              ))}
            </div>
            <div className="tracker-ladder-key" aria-hidden="true"><span>−6 floor</span><span>reset {signed(reset)}</span><span>+10 top</span></div>
            <button type="button" className="tracker-action" onClick={() => update(burnMomentum)} disabled={now <= reset}>
              <Icon name="torch" />
              <strong>Burn Momentum</strong>
              <small>{now <= reset ? `Needs more than ${signed(reset)}` : `Reset to ${signed(reset)}. Ignore the Fear die: improve a roll one step.`}</small>
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

          <section className="tracker-card" aria-label="Momentum of this fight">
            <h4><Icon name="combat" />This fight<small>{fighting ? 'recorded' : 'no fight'}</small></h4>
            <FightMomentum tracker={tracker} />
          </section>

          <section className="tracker-card" aria-label="Conditions">
            <h4><Icon name="stress" />Conditions<small>{tracker.debilities.length === 0 ? 'none' : `${tracker.debilities.length} lower Momentum`}</small></h4>
            <p className="tracker-note">{tracker.debilities.length === 0
              ? 'Conditions live on your character sheet. Each Ironsworn one lowers your maximum Momentum.'
              : `${tracker.debilities.map(id => DEBILITIES.find(item => item.id === id)?.label ?? id).join(', ')}. Change them on your character sheet.`}</p>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
