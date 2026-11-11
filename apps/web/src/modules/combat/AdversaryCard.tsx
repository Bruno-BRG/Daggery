import { useState } from 'react';
import { sendRoll } from '../../sync/rollSocket';
import {
  CONDITIONS,
  clamp,
  costOf,
  describeRoll,
  fearCost,
  fearValue,
  groupStatus,
  hpForDamage,
  hpStatus,
  hordeDamage,
  minionDefeats,
  newId,
  signed,
  totalOf,
  type AdversaryDoc,
  type AdversaryFeature,
  type AdversarySource,
  type ConditionKey,
  type Ctx,
} from './model';
import { Badge, Button, DamageInput, Track, type Tone } from './ui';

const KIND_TONE: Record<string, Tone> = {
  Passive: 'slate',
  Action: 'amber',
  Reaction: 'sky',
  Evolution: 'violet',
};

interface CardProps {
  ctx: Ctx;
  id: string;
  doc: AdversaryDoc;
  src: AdversarySource | undefined;
}

/** One adversary on the encounter. Players see the name, features and a qualitative HP status only. */
export function AdversaryCard({ ctx, id, doc, src }: CardProps) {
  const [note, setNote] = useState<string | null>(null);
  const gm = ctx.isGM;
  const fear = fearValue(ctx.docs);

  if (!src) {
    return (
      <article className="rounded-xl border border-rose-900 bg-slate-900/80 p-4 text-sm text-rose-300">
        {doc.name}: catalog entry not found.
        {gm && (
          <Button tone="rose" className="ml-2" onClick={() => ctx.remove(id)}>
            Remove
          </Button>
        )}
      </article>
    );
  }

  const group = doc.groupSize !== null;
  const size = doc.groupSize ?? 0;
  const alive = Math.max(0, size - doc.defeated);
  const hpMax = Math.max(1, src.hp);
  const defeated = group ? alive === 0 : doc.hpMarked >= hpMax;
  const features = src.features;
  const thresholds = src.thresholds;

  const save = (patch: Partial<AdversaryDoc>) => ctx.set(id, { ...doc, ...patch, kind: 'adversary' });

  function rollAttack() {
    if (!src) return;
    const { modifier, name } = src.attack;
    const notation = `1d20${modifier === 0 ? '' : typeof modifier === 'string' ? `+${modifier}` : signed(modifier)}`;
    void ctx.dice
      .roll({ kind: 'dice', notation }, {
        author: ctx.author,
        onComputed: (payload) => {
          sendRoll({ type: 'roll', author: ctx.author, ...payload });
          const text = describeRoll(payload);
          setNote(`Attack (${name}): ${text}`);
          ctx.log('roll', `${doc.name} attacks with ${name}: ${text}`, `${doc.name} attacks with ${name}: ${totalOf(payload)}`);
        },
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : 'Roll failed'));
  }

  function rollDamage() {
    if (!src) return;
    const { name } = src.attack;
    const damage = hordeDamage(features, doc.hpMarked, hpMax, src.attack.damage);
    void ctx.dice
      .roll({ kind: 'dice', notation: damage }, {
        author: ctx.author,
        onComputed: (payload) => {
          sendRoll({ type: 'roll', author: ctx.author, ...payload });
          const text = describeRoll(payload);
          setNote(`Damage (${name}): ${text}`);
          ctx.log('roll', `${doc.name} deals damage with ${name}: ${text}`, `${doc.name} deals ${totalOf(payload)} damage`);
        },
      })
      .catch((error: unknown) => setNote(error instanceof Error ? error.message : 'Roll failed'));
  }

  /** Damage the PCs dealt to this adversary. */
  function applyDamage(damage: number) {
    if (group) {
      const killed = Math.min(alive, minionDefeats(damage, features));
      if (killed <= 0) return;
      const defeatedNow = doc.defeated + killed;
      save({ defeated: defeatedNow });
      const left = size - defeatedNow;
      ctx.log(
        'damage',
        `${doc.name}: ${damage} damage defeated ${killed} (${left} left)`,
        left === 0 ? `${doc.name}: all defeated` : `${doc.name}: ${left} left`,
      );
      if (left === 0) ctx.log('defeat', `${doc.name}: group defeated`, `${doc.name}: group defeated`);
      return;
    }
    if (!thresholds) return;
    const { marks, severity } = hpForDamage(damage, thresholds);
    if (marks === 0 || !severity) return;
    const hpMarked = Math.min(hpMax, doc.hpMarked + marks);
    save({ hpMarked });
    ctx.log(
      'damage',
      `${doc.name} took ${damage} damage (${severity}): +${marks} HP (${hpMarked}/${hpMax})`,
      `${doc.name} took ${severity} damage`,
    );
    if (hpMarked >= hpMax && doc.hpMarked < hpMax) {
      ctx.log('defeat', `${doc.name} was defeated`, `${doc.name} was defeated!`);
    }
  }

  function setHp(next: number) {
    const hpMarked = clamp(next, 0, hpMax);
    if (hpMarked === doc.hpMarked) return;
    save({ hpMarked });
    if (hpMarked >= hpMax && doc.hpMarked < hpMax) {
      ctx.log('defeat', `${doc.name} was defeated`, `${doc.name} was defeated!`);
    }
  }

  function setGroupDefeated(defeatedNow: number) {
    save({ defeated: clamp(defeatedNow, 0, size) });
  }

  function toggleCondition(key: ConditionKey) {
    save({ conditions: { ...doc.conditions, [key]: !doc.conditions[key] } });
  }

  function addCounter(label: string) {
    const clean = label.trim();
    if (!clean) return;
    save({ counters: [...doc.counters, { id: newId(), label: clean, value: 0 }] });
  }

  function bumpCounter(counterId: string, delta: number) {
    save({
      counters: doc.counters.map((c) => (c.id === counterId ? { ...c, value: Math.max(0, c.value + delta) } : c)),
    });
  }

  function removeCounter(counterId: string) {
    save({ counters: doc.counters.filter((c) => c.id !== counterId) });
  }

  /** Spends Fear to use a Fear feature, or to spotlight this adversary (1 Fear). */
  function spendFear(cost: number, text: string, playerText: string) {
    if (fear < cost) return;
    ctx.set('fear', { kind: 'fear', value: fear - cost });
    ctx.log('feature', text, playerText);
  }

  const cardTone = defeated ? 'border-slate-700 opacity-60' : 'border-slate-700';

  return (
    <article className={`flex flex-col gap-3 rounded-xl border bg-slate-900/80 p-4 ${cardTone}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="truncate">{doc.name}</span>
            {defeated && <Badge tone="rose">Defeated</Badge>}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone="violet">Tier {src.tier}</Badge>
            <Badge tone="sky">{src.type}</Badge>
            {gm && <Badge title="Battle points">{group ? `${costOf(src.type)} BP / group` : `${costOf(src.type)} BP`}</Badge>}
          </div>
        </div>
        {gm && (
          <Button tone="rose" onClick={() => ctx.remove(id)} aria-label={`Remove ${doc.name}`}>
            Remove
          </Button>
        )}
      </header>

      <p className="text-xs italic leading-relaxed text-slate-400">{src.motives}</p>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-950/60 p-2 text-center text-xs">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Difficulty</div>
          <div className="text-base font-semibold tabular-nums text-slate-100">{src.difficulty}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Major / Severe</div>
          <div className="text-base font-semibold tabular-nums text-slate-100">
            {thresholds ? `${thresholds.major} / ${thresholds.severe}` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Attack</div>
          <div className="text-base font-semibold tabular-nums text-slate-100">{signed(src.attack.modifier)}</div>
        </div>
      </div>

      {/* HP and Stress */}
      <div className="flex flex-col gap-2 text-xs">
        {group ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-400">
              Minions:{' '}
              <span className="font-semibold text-slate-100">
                {gm ? `${alive}/${size} alive` : groupStatus(doc.defeated, size)}
              </span>
            </span>
            {gm && (
              <span className="flex items-center gap-1">
                <Button onClick={() => setGroupDefeated(doc.defeated - 1)} disabled={doc.defeated === 0}>
                  −1 defeated
                </Button>
                <Button onClick={() => setGroupDefeated(doc.defeated + 1)} disabled={alive === 0}>
                  +1 defeated
                </Button>
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-400">
                HP{' '}
                {gm ? (
                  <span className="font-semibold tabular-nums text-slate-100">
                    {hpMax - doc.hpMarked}/{hpMax}
                  </span>
                ) : (
                  <span className="font-semibold text-slate-100">{hpStatus(doc.hpMarked, hpMax)}</span>
                )}
              </span>
              {gm && <Track label={`${doc.name}'s HP`} max={hpMax} marked={doc.hpMarked} onSet={setHp} />}
            </div>
            {src.stress !== null && gm && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-400">
                  Stress <span className="font-semibold tabular-nums text-slate-100">{src.stress - doc.stressMarked}/{src.stress}</span>
                </span>
                <Track
                  label={`${doc.name}'s Stress`}
                  max={src.stress}
                  marked={doc.stressMarked}
                  tone="sky"
                  onSet={(stressMarked) => save({ stressMarked: clamp(stressMarked, 0, src.stress ?? 0) })}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Attack line and GM dice */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-xs">
        <div className="flex flex-wrap items-baseline gap-x-2 text-slate-300">
          <span className="font-semibold text-slate-100">{src.attack.name}</span>
          <span className="text-slate-500">
            {src.attack.range} · {signed(src.attack.modifier)} · {src.attack.damage} {src.attack.damageType}
          </span>
        </div>
        {gm && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button tone="amber" onClick={rollAttack}>
              Roll attack
            </Button>
            <Button tone="rose" onClick={rollDamage}>
              Roll damage
            </Button>
          </div>
        )}
        {note && <p className="mt-2 tabular-nums text-slate-300">{note}</p>}
      </div>

      {gm && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-800 p-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Damage taken by the adversary</span>
          <DamageInput
            onApply={applyDamage}
            describe={(damage) => {
              if (group) {
                const k = Math.min(alive, minionDefeats(damage, features));
                return `Defeats ${k} minion(s)`;
              }
              if (!thresholds) return 'No thresholds';
              const { marks, severity } = hpForDamage(damage, thresholds);
              return severity ? `${severity}: +${marks} HP` : 'No damage';
            }}
          />
        </div>
      )}

      {/* Conditions */}
      <div className="flex flex-wrap items-center gap-1">
        {CONDITIONS.map((condition) => {
          const on = doc.conditions[condition.key];
          if (!gm) {
            return on ? (
              <Badge key={condition.key} tone="amber">
                {condition.label}
              </Badge>
            ) : null;
          }
          return (
            <Button
              key={condition.key}
              tone={on ? 'amber' : 'slate'}
              aria-pressed={on}
              onClick={() => toggleCondition(condition.key)}
            >
              {condition.label}
            </Button>
          );
        })}
      </div>

      {/* Token counters */}
      {(doc.counters.length > 0 || gm) && (
        <CounterRow
          gm={gm}
          counters={doc.counters}
          onAdd={addCounter}
          onBump={bumpCounter}
          onRemove={removeCounter}
        />
      )}

      {src.experiences.length > 0 && (
        <p className="text-xs text-slate-400">
          Experiences:{' '}
          {src.experiences.map((exp, i) => (
            <span key={exp.name}>
              {i > 0 && ', '}
              <span className="text-slate-200">
                {exp.name} {signed(exp.bonus)}
              </span>
            </span>
          ))}
        </p>
      )}

      {/* Features */}
      <ul className="flex flex-col gap-2">
        {features.map((feature) => (
          <FeatureRow
            key={feature.name}
            feature={feature}
            gm={gm}
            fear={fear}
            onSpend={(cost) =>
              spendFear(cost, `${doc.name} used ${feature.name} (spent ${cost} Fear)`, `${doc.name} used ${feature.name}`)
            }
          />
        ))}
        {gm && (
          <li>
            <Button
              tone="rose"
              disabled={fear < 1}
              onClick={() => spendFear(1, `GM spent 1 Fear to spotlight ${doc.name}`, `Spotlight on ${doc.name}`)}
            >
              Spotlight on {doc.name} (1 Fear)
            </Button>
          </li>
        )}
      </ul>
    </article>
  );
}

function FeatureRow({
  feature,
  gm,
  fear,
  onSpend,
}: {
  feature: AdversaryFeature;
  gm: boolean;
  fear: number;
  onSpend: (cost: number) => void;
}) {
  const cost = fearCost(feature.text);
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={KIND_TONE[feature.kind] ?? 'slate'}>{feature.kind}</Badge>
        {cost !== null && (
          <Badge tone="rose" title="This feature spends Fear">
            Fear{cost === 'variable' ? ' var.' : cost > 1 ? ` ${cost}` : ''}
          </Badge>
        )}
        <span className="text-xs font-semibold text-slate-100">{feature.name}</span>
        {gm && typeof cost === 'number' && (
          <Button tone="rose" className="ml-auto" disabled={fear < cost} onClick={() => onSpend(cost)}>
            Spend {cost} Fear
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{feature.text}</p>
    </li>
  );
}

function CounterRow({
  gm,
  counters,
  onAdd,
  onBump,
  onRemove,
}: {
  gm: boolean;
  counters: AdversaryDoc['counters'];
  onAdd: (label: string) => void;
  onBump: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  const [label, setLabel] = useState('');
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {counters.map((counter) => (
          <span key={counter.id} className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5">
            <span className="text-slate-300">{counter.label}</span>
            <b className="tabular-nums text-slate-100">{counter.value}</b>
            {gm && (
              <>
                <Button aria-label={`Decrease ${counter.label}`} onClick={() => onBump(counter.id, -1)} className="px-1.5">
                  −
                </Button>
                <Button aria-label={`Increase ${counter.label}`} onClick={() => onBump(counter.id, 1)} className="px-1.5">
                  +
                </Button>
                <Button aria-label={`Remove ${counter.label}`} tone="rose" onClick={() => onRemove(counter.id)} className="px-1.5">
                  ×
                </Button>
              </>
            )}
          </span>
        ))}
      </div>
      {gm && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(label);
            setLabel('');
          }}
        >
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Counter (e.g. Slow, Marks)"
            aria-label="Counter name"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
          />
          {['Slow', 'Relentless', 'Marks'].map((preset) => (
            <Button key={preset} onClick={() => onAdd(preset)}>
              {preset}
            </Button>
          ))}
          <Button type="submit" disabled={!label.trim()}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
