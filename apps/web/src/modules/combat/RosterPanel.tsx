import { useState, type FormEvent } from 'react';
import {
  clamp,
  hpForDamage,
  newId,
  toInt,
  type Ctx,
  type PcDoc,
  type PcView,
} from './model';
import { Badge, Button, DamageInput, Panel, Track } from './ui';

const EMPTY_DRAFT = { name: '', evasion: '', hp: '6', stress: '6', major: '', severe: '' };

/** PCs from the sheets namespace (read only here) plus quick-add PCs, which can be edited. */
export function RosterPanel({ ctx, pcs }: { ctx: Ctx; pcs: PcView[] }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  function addPc(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    const major = toInt(draft.major);
    const severe = toInt(draft.severe);
    const doc: PcDoc = {
      kind: 'pc',
      name,
      evasion: toInt(draft.evasion),
      hpMax: clamp(toInt(draft.hp) ?? 6, 1, 12),
      hpMarked: 0,
      stressMax: clamp(toInt(draft.stress) ?? 6, 1, 12),
      stressMarked: 0,
      thresholds: major !== null && severe !== null ? { major, severe } : null,
      addedAt: Date.now(),
    };
    ctx.set(`pc:${newId()}`, doc);
    setDraft(EMPTY_DRAFT);
  }

  return (
    <Panel title="PCs">
      {pcs.length === 0 ? (
        <p className="text-xs text-slate-500">Create a character or add a quick PC below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pcs.map((pc) => (
            <li key={pc.key} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{pc.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  {pc.evasion !== null && (
                    <span>
                      Evasion <b className="tabular-nums text-slate-200">{pc.evasion}</b>
                    </span>
                  )}
                  {pc.thresholds && (
                    <span title="Damage thresholds">
                      M {pc.thresholds.major} / S {pc.thresholds.severe}
                    </span>
                  )}
                </span>
              </div>

              {pc.manual ? (
                <ManualPc ctx={ctx} id={pc.key} pc={pc.manual} gm={ctx.isGM} />
              ) : (
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                  <span>
                    HP{' '}
                    <b className="tabular-nums text-slate-200">
                      {pc.sheetHp ? `${pc.sheetHp.current}/${pc.sheetHp.max}` : '—'}
                    </b>
                  </span>
                  <span>
                    Stress{' '}
                    <b className="tabular-nums text-slate-200">
                      {pc.sheetStress ? `${pc.sheetStress.current}/${pc.sheetStress.max}` : '—'}
                    </b>
                  </span>
                  <Badge>sheet</Badge>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addPc} className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-xs">
        <label className="col-span-3 flex flex-col gap-1 text-slate-400">
          Quick PC
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Name"
            required
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          />
        </label>
        <NumField label="Evasion" value={draft.evasion} onChange={(evasion) => setDraft({ ...draft, evasion })} />
        <NumField label="Max HP" value={draft.hp} onChange={(hp) => setDraft({ ...draft, hp })} />
        <NumField label="Max Stress" value={draft.stress} onChange={(stress) => setDraft({ ...draft, stress })} />
        <NumField label="Major" value={draft.major} onChange={(major) => setDraft({ ...draft, major })} />
        <NumField label="Severe" value={draft.severe} onChange={(severe) => setDraft({ ...draft, severe })} />
        <div className="col-span-3 flex justify-end">
          <Button type="submit" tone="emerald" disabled={!draft.name.trim()}>
            Add PC
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-slate-400">
      {label}
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
      />
    </label>
  );
}

function ManualPc({ ctx, id, pc, gm }: { ctx: Ctx; id: string; pc: PcDoc; gm: boolean }) {
  const save = (patch: Partial<PcDoc>) => ctx.set(id, { ...pc, ...patch, kind: 'pc' });

  function applyDamage(damage: number) {
    if (!pc.thresholds) return;
    const { marks, severity } = hpForDamage(damage, pc.thresholds);
    if (marks === 0) return;
    const hpMarked = Math.min(pc.hpMax, pc.hpMarked + marks);
    save({ hpMarked });
    ctx.log('damage', `${pc.name} took ${damage} damage (${severity}): +${marks} HP`, `${pc.name} took ${severity} damage`);
  }

  function remove() {
    if (window.confirm(`Remove the quick PC "${pc.name}"?`)) ctx.remove(id);
  }

  return (
    <div className="mt-2 flex flex-col gap-2 text-xs text-slate-400">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          HP <span className="tabular-nums text-slate-200">{pc.hpMax - pc.hpMarked}/{pc.hpMax}</span>
          {gm && (
            <Track
              label={`${pc.name}'s HP`}
              max={pc.hpMax}
              marked={pc.hpMarked}
              onSet={(hpMarked) => save({ hpMarked: clamp(hpMarked, 0, pc.hpMax) })}
            />
          )}
        </span>
        <span className="flex items-center gap-2">
          Stress <span className="tabular-nums text-slate-200">{pc.stressMax - pc.stressMarked}/{pc.stressMax}</span>
          {gm && (
            <Track
              label={`${pc.name}'s Stress`}
              max={pc.stressMax}
              marked={pc.stressMarked}
              tone="sky"
              onSet={(stressMarked) => save({ stressMarked: clamp(stressMarked, 0, pc.stressMax) })}
            />
          )}
        </span>
      </div>
      {gm && pc.thresholds && (
        <DamageInput
          onApply={applyDamage}
          describe={(damage) => {
            const { marks, severity } = hpForDamage(damage, pc.thresholds ?? { major: 0, severe: 0 });
            return severity ? `${severity}: +${marks} HP` : 'No damage';
          }}
        />
      )}
      {gm && (
        <div className="flex justify-end">
          <Button tone="rose" onClick={remove}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
