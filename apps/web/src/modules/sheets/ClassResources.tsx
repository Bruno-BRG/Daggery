import { useId, useState } from 'react';
import type { Sheet, ClassResourceValue } from './types';
import { classResourceDefinitions, classResourceFacts, classResourceValue, getClass, resetClassResources, setClassResource, type ClassResourceDefinition } from './rules';
import { Icon } from '../../components/Icon';

type Props = { sheet: Sheet; onUpdate: (update: (current: Sheet) => Sheet) => void };

/** Manual rule trackers: recording an ability does not secretly pay a cost or resolve its effect. */
export function ClassResources({ sheet, onUpdate }: Props) {
  const definitions = classResourceDefinitions(sheet);
  const facts = classResourceFacts(sheet);
  if (!definitions.length && !facts.length) return null;
  const classes = [...new Set(definitions.map(definition => definition.classId))];
  return <section className="sheet-panel class-resources" aria-label="Class resources">
    <header className="sheet-panel-head"><h2 className="sheet-section-title"><Icon name="spark" />Class resources</h2></header>
    <p className="sheet-note">Track your class features here. Adjusting a tracker does not spend Hope or Stress, roll dice, or apply an ability's effects.</p>
    {facts.length > 0 && <dl className="class-resource-facts">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {classes.map(classId => <div className="class-resource-group" key={classId}>
      {classes.length > 1 && <h3>{getClass(classId)?.name ?? classId}</h3>}
      {definitions.filter(definition => definition.classId === classId).map(definition => <Tracker key={definition.id} definition={definition} value={classResourceValue(sheet, definition.id)} onChange={value => onUpdate(current => setClassResource(current, definition.id, value))} />)}
    </div>)}
    {definitions.some(definition => definition.reset === 'scene' || definition.reset === 'session') && <details className="class-resource-resets"><summary>Scene & session changes</summary>
      <p className="sheet-note">Rest trackers reset when you begin a rest. Use these controls when your table ends a scene or resets a session. A session reset clears unspent dice and session-use marks; persistent choices and Favor are kept.</p>
      <div className="sheet-inline">
        {definitions.some(definition => definition.reset === 'scene') && <button type="button" className="sheet-ghost" onClick={() => onUpdate(current => resetClassResources(current, 'scene'))}>End scene</button>}
        {definitions.some(definition => definition.reset === 'session') && <button type="button" className="sheet-ghost" onClick={() => onUpdate(current => resetClassResources(current, 'session'))}>Reset session trackers</button>}
      </div>
    </details>}
  </section>;
}

function Tracker({ definition, value, onChange }: { definition: ClassResourceDefinition; value: ClassResourceValue; onChange: (value: ClassResourceValue) => void }) {
  const id = useId();
  const helpId = `${id}-help`;
  const [draft, setDraft] = useState('');
  const values = Array.isArray(value) ? value : [];
  const number = typeof value === 'number' ? value : 0;
  const inputProps = { id, 'aria-describedby': helpId };
  const entryLabel = definition.id.includes('experience') ? 'Experience' : 'Target';
  const addTarget = () => {
    const target = draft.trim();
    if (!target || (values as string[]).includes(target)) return;
    onChange([...(values as string[]), target]);
    setDraft('');
  };
  return <div className="class-resource-row">
    {definition.kind === 'toggle' ? <label className="class-resource-toggle"><input {...inputProps} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /><span>{definition.label}</span></label> : <label className="class-resource-label" htmlFor={id}>{definition.label}{definition.kind === 'selection' && <span>{values.length}{definition.max !== undefined ? ` / ${definition.max}` : ''} {definition.id === 'brawler-stances' ? 'known' : 'selected'}</span>}</label>}
    {definition.kind === 'text' && <input {...inputProps} className="sheet-input" value={String(value)} onChange={event => onChange(event.target.value)} />}
    {definition.kind === 'counter' && <div className="class-resource-counter">
      <button type="button" className="sheet-ghost" aria-label={`Decrease ${definition.label}`} disabled={number <= (definition.min ?? 0)} onClick={() => onChange(number - 1)}><Icon name="minus" /></button>
      <input {...inputProps} type="number" inputMode="numeric" min={definition.min ?? 0} max={definition.max} value={number} onChange={event => onChange(event.target.valueAsNumber)} />
      {definition.max !== undefined && <span>/ {definition.max}</span>}
      <button type="button" className="sheet-ghost" aria-label={`Increase ${definition.label}`} disabled={definition.max !== undefined && number >= definition.max} onClick={() => onChange(number + 1)}><Icon name="plus" /></button>
    </div>}
    {definition.kind === 'choice' && <select {...inputProps} className="sheet-input" value={String(value)} onChange={event => onChange(event.target.value)}><option value="">None selected</option>{definition.options?.filter(option => option.id !== '').map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}
    {definition.kind === 'selection' && <div id={id} role="group" aria-label={definition.label} aria-describedby={helpId} className="class-resource-options">{definition.options?.map(option => {
      const selected = (values as string[]).includes(option.id);
      return <label key={option.id}><input type="checkbox" checked={selected} disabled={!selected && definition.max !== undefined && values.length >= definition.max} onChange={() => onChange(selected ? (values as string[]).filter(item => item !== option.id) : [...values as string[], option.id])} /><span>{option.label}</span></label>;
    })}</div>}
    {definition.kind === 'list' && <div className="class-resource-targets">
      <ul>{(values as string[]).map((target, index) => <li key={`${index}-${target}`}><span>{target}</span><button type="button" className="sheet-ghost" aria-label={`Remove ${definition.label}: ${target}`} onClick={() => onChange(values.filter((_, position) => position !== index) as string[])}><Icon name="close" /></button></li>)}</ul>
      <div className="sheet-inline"><input {...inputProps} className="sheet-input" placeholder={`${entryLabel} name`} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTarget(); } }} /><button type="button" className="sheet-ghost" disabled={!draft.trim() || (definition.max !== undefined && values.length >= definition.max)} onClick={addTarget}>Add {entryLabel.toLowerCase()}</button></div>
    </div>}
    {definition.kind === 'dice' && <div id={id} role="group" aria-label={definition.label} aria-describedby={helpId} className="class-resource-dice">{(values as number[]).map((face, index) => <div key={index}><select className="sheet-input" aria-label={`${definition.label} die ${index + 1}`} value={face} onChange={event => onChange((values as number[]).map((old, position) => position === index ? Number(event.target.value) : old))}>{[1, 2, 3, 4].map(side => <option key={side} value={side}>{side}</option>)}</select><button type="button" className="sheet-ghost" aria-label={`Spend ${definition.label} die ${index + 1}`} onClick={() => onChange(values.filter((_, position) => position !== index) as number[])}><Icon name="minus" /></button></div>)}<button type="button" className="sheet-ghost" disabled={definition.max !== undefined && values.length >= definition.max} onClick={() => onChange([...values as number[], 1])}>Record a die</button></div>}
    <p id={helpId} className="sheet-note">{definition.help}</p>
  </div>;
}
