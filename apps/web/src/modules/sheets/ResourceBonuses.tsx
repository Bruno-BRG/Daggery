import { Icon } from '../../components/Icon';
import { hpMax, stressMax } from './rules';
import { setExtraResourceSlots, type ExtraSlotField } from './resource-slots';
import type { Sheet } from './types';

export function ResourceBonuses({ sheet, mutate }: {
  sheet: Sheet;
  mutate: (update: (current: Sheet) => Sheet) => void;
}) {
  const change = (field: ExtraSlotField, raw: string) => {
    mutate(current => setExtraResourceSlots(current, field, raw));
  };
  return <div className="folio-bonus-bar" role="group" aria-label="Extra resource slots" aria-describedby="resource-bonus-help">
    <span className="folio-bonus-title"><Icon name="settings" /><span>Item &amp; effect bonuses</span></span>
    <label className="folio-bonus-field">+ HP slots<input type="number" min={0} step={1} inputMode="numeric" aria-label="Extra Hit Point slots" value={sheet.extraHpSlots ?? 0} onChange={event => change('extraHpSlots', event.target.value)} /></label>
    <label className="folio-bonus-field">+ Stress slots<input type="number" min={0} step={1} inputMode="numeric" aria-label="Extra Stress slots" value={sheet.extraStressSlots ?? 0} onChange={event => change('extraStressSlots', event.target.value)} /></label>
    <span className="folio-bonus-note" aria-live="polite">Max HP {hpMax(sheet)} · Stress {stressMax(sheet)}</span>
    <span className="folio-bonus-help" id="resource-bonus-help">Add slots from gear, trinkets, transformations, or other effects here. These stack with ancestry and level-up bonuses; remove them when the effect ends.</span>
  </div>;
}
