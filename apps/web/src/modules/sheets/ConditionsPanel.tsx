import { DAGGERHEART_CONDITIONS, IRONSWORN_CONDITIONS, maxMomentum, parseConditions, setDebility, toggleCondition, debilitiesOf, type SheetCondition } from '@daggery/shared';
import { Icon } from '../../components/Icon';
import { useMomentum } from '../../systems/useMomentum';
import { useActiveHero } from './activeHero';
import type { Sheet } from './types';
import './conditions.css';

const IRON_GROUPS = [
  { id: 'condition', label: 'Conditions', note: 'Clear them with the move that names them.' },
  { id: 'bane', label: 'Banes', note: 'Lasting. They stay until the story clears them.' },
  { id: 'burden', label: 'Burdens', note: 'Clear them by finishing the quest they came from.' },
] as const;

/**
 * The conditions of a hero, on the character sheet. Daggerheart's three conditions describe where you
 * stand in the scene. Ironsworn's eight Debilities describe your state, and each one lowers the most
 * Momentum you can hold.
 */
export function ConditionsPanel({ sheet, onUpdate }: { sheet: Sheet; onUpdate: (change: (current: Sheet) => Sheet) => void }) {
  const marked = parseConditions(sheet.conditions);
  const { hero } = useActiveHero();
  const { update } = useMomentum();
  const debilities = debilitiesOf(marked);

  const toggle = (item: SheetCondition) => {
    const on = !marked.includes(item.id);
    // The active hero's Debilities also move the Momentum ceiling, so the tracker makes the change.
    if (item.momentum && hero?.id === sheet.id) update(current => setDebility(current, item.id as never, on));
    else onUpdate(current => ({ ...current, conditions: toggleCondition(current.conditions ?? [], item.id, on) }));
  };

  const card = (item: SheetCondition) => (
    <button key={item.id} type="button" className="condition-card" data-source={item.source} data-group={item.group}
      aria-pressed={marked.includes(item.id)} onClick={() => toggle(item)}>
      <span className="condition-name">{item.label}{item.momentum && <em>−1 Momentum max</em>}</span>
      <small>{item.text}</small>
    </button>
  );

  return (
    <div className="conditions-panel">
      <p className="conditions-summary" role="status">
        {marked.length === 0 ? 'No conditions. Tap one to mark it.' : <><Icon name="stress" /><strong>{marked.length} marked:</strong> {marked.join(', ')}</>}
        {debilities.length > 0 && <span> · Momentum max {maxMomentum(debilities)}</span>}
      </p>
      <section aria-label="Daggerheart conditions">
        <h4>Daggerheart <small>where you stand in the scene</small></h4>
        <div className="condition-grid">{DAGGERHEART_CONDITIONS.map(card)}</div>
      </section>
      {IRON_GROUPS.map(group => (
        <section key={group.id} aria-label={`Ironsworn ${group.label.toLowerCase()}`}>
          <h4>Ironsworn {group.label.toLowerCase()} <small>{group.note}</small></h4>
          <div className="condition-grid">{IRONSWORN_CONDITIONS.filter(item => item.group === group.id).map(card)}</div>
        </section>
      ))}
    </div>
  );
}
