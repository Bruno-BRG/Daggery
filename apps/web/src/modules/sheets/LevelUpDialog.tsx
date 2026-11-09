import { useMemo, useState } from 'react';
import { RuleCard, CardText } from '../../components/RuleCard';
import { classes } from '@daggery/content';
import type { TraitName } from '@daggery/shared';
import {
  DOMAIN_LABELS,
  MAX_LEVEL,
  TRAIT_LABELS,
  TRAIT_ORDER,
  canGainMastery,
  cardImage,
  eligibleDomainCards,
  getClass,
  getSubclass,
  isDoubleSlotAdvancement,
  isValidPickCount,
  makeId,
  traitNameFromWeapon,
  tierForLevel,
  tierLabel,
} from './rules';
import type { Sheet } from './types';

interface LevelUpDialogProps {
  sheet: Sheet;
  onChange: (sheet: Sheet) => void;
  onClose: () => void;
}

type AdvanceId =
  | 'traits'
  | 'hp'
  | 'stress'
  | 'experiences'
  | 'domain-card'
  | 'evasion'
  | 'subclass'
  | 'proficiency'
  | 'multiclass';

interface AdvanceDef {
  id: AdvanceId;
  title: string;
  detail: string;
  minTier: number;
}

const ADVANCEMENTS: AdvanceDef[] = [
  { id: 'traits', title: 'Increase two traits', detail: 'Gain +1 to two unmarked traits, then mark them.', minTier: 1 },
  { id: 'hp', title: 'Gain a Hit Point slot', detail: 'Permanently increase maximum Hit Points by 1 (max 12).', minTier: 1 },
  { id: 'stress', title: 'Gain a Stress slot', detail: 'Permanently increase maximum Stress by 1 (max 12).', minTier: 1 },
  { id: 'experiences', title: '+1 to two Experiences', detail: 'Permanently increase two Experiences by +1.', minTier: 1 },
  { id: 'domain-card', title: 'New domain card', detail: 'Choose a card up to your new level from an accessible domain.', minTier: 1 },
  { id: 'evasion', title: 'Gain +1 Evasion', detail: 'Permanently increase your Evasion by 1.', minTier: 1 },
  { id: 'subclass', title: 'Upgrade subclass card', detail: 'Foundation → Specialization → Mastery. Unavailable after multiclassing to mastery.', minTier: 3 },
  { id: 'proficiency', title: 'Increase Proficiency', detail: 'Gain +1 Proficiency (one more damage die). Uses both level-up slots.', minTier: 3 },
  { id: 'multiclass', title: 'Multiclass', detail: 'Choose a second class, one new domain, and a foundation subclass card. Uses both level-up slots.', minTier: 3 },
];

function tierRange(tier: number): [number, number] {
  if (tier === 1) return [1, 1];
  if (tier === 2) return [2, 4];
  if (tier === 3) return [5, 7];
  return [8, 10];
}

export default function LevelUpDialog({ sheet, onChange, onClose }: LevelUpDialogProps) {
  const newLevel = sheet.level + 1;
  const newTier = tierForLevel(newLevel);
  const oldTier = tierForLevel(sheet.level);
  const enteringTier = newTier > oldTier;
  const levelValid = sheet.level < MAX_LEVEL;
  const [tierMin, tierMax] = tierRange(newTier);

  const [chosen, setChosen] = useState<AdvanceId[]>([]);
  const [traitPicks, setTraitPicks] = useState<TraitName[]>([]);
  const [experiencePicks, setExperiencePicks] = useState<string[]>([]);
  const [domainPick, setDomainPick] = useState<string | null>(null);
  const [multiclassPick, setMulticlassPick] = useState<string | null>(null);
  const [multiclassDomainPick, setMulticlassDomainPick] = useState<string | null>(null);
  const [multiclassSubclassPick, setMulticlassSubclassPick] = useState<string | null>(null);
  const [spellcastPick, setSpellcastPick] = useState<TraitName | null>(null);
  const [newExperience, setNewExperience] = useState('');

  const unmarkedTraits = TRAIT_ORDER.filter((trait) => !sheet.traitMarks.includes(trait));
  const domainOptions = useMemo(() => {
    if (!levelValid) return [];
    const context = multiclassPick
      ? { ...sheet, multiclassId: multiclassPick, multiclassDomain: multiclassDomainPick }
      : sheet;
    return eligibleDomainCards(context, newLevel);
  }, [sheet, newLevel, levelValid, multiclassPick, multiclassDomainPick]);
  const multiclassClass = classes.find((entry) => entry.id === multiclassPick);
  const multiclassSubclass = multiclassClass?.subclasses.find((entry) => entry.id === multiclassSubclassPick);
  const primaryDomains = getClass(sheet.classId)?.domains ?? [];
  const multiclassDomainOptions =
    multiclassClass?.domains.filter((domain) => !primaryDomains.includes(domain)) ?? [];
  const multiclassOptions = classes.filter(
    (entry) => entry.id !== sheet.classId && entry.id !== sheet.multiclassId,
  );
  const primarySpellcast = traitNameFromWeapon(getSubclass(sheet.classId, sheet.subclassId)?.spellcastTrait ?? '') ?? traitNameFromWeapon(getSubclass(sheet.classId, sheet.subclassId)?.spellcastTrait ?? 'does-not-exist');
  // Spellcast trait from subclass text may be capitalized trait name (e.g. "Presence").
  const primarySpellcastRaw = getSubclass(sheet.classId, sheet.subclassId)?.spellcastTrait;
  const multiclassSpellcastRaw = multiclassSubclass?.spellcastTrait;
  const toTrait = (raw?: string | null): TraitName | null => {
    if (!raw) return null;
    const label = raw.toLowerCase();
    return (TRAIT_ORDER as readonly string[]).includes(label) ? (label as TraitName) : null;
  };
  const spellcastOptions: TraitName[] = [];
  const primaryTrait = toTrait(primarySpellcastRaw);
  const multiclassTrait = toTrait(multiclassSpellcastRaw);
  if (primaryTrait) spellcastOptions.push(primaryTrait);
  if (multiclassTrait && multiclassTrait !== primaryTrait) spellcastOptions.push(multiclassTrait);
  void primarySpellcast;

  const hasDoubleSlot = chosen.some((id) => isDoubleSlotAdvancement(id));

  const takenThisTier = (id: AdvanceId): boolean =>
    (sheet.advancementHistory ?? []).some(
      (entry) => entry.advancement === id && entry.level >= tierMin && entry.level <= tierMax,
    );

  const optionUnavailable = (def: AdvanceDef): boolean => {
    if (newTier < def.minTier) return true;
    if (def.id === 'traits' && unmarkedTraits.length < 2) return true;
    if (def.id === 'experiences' && sheet.experiences.length < 2) return true;
    if (def.id === 'subclass' && !canGainMastery(sheet, chosen)) return true;
    if (def.id === 'multiclass' && sheet.multiclassId !== null) return true;
    // Each advancement may be taken at most once per tier (Core level-up sheet).
    if (takenThisTier(def.id)) return true;
    return false;
  };

  function toggleAdvance(id: AdvanceId) {
    if (chosen.includes(id)) {
      setChosen((current) => current.filter((entry) => entry !== id));
      return;
    }
    if (isDoubleSlotAdvancement(id)) {
      // Core Rulebook: multiclass and Proficiency require both level-up slots.
      setChosen([id]);
      return;
    }
    if (hasDoubleSlot) return;
    if (chosen.length >= 2) return;
    setChosen((current) => [...current, id]);
  }

  function toggleTrait(trait: TraitName) {
    setTraitPicks((current) => {
      if (current.includes(trait)) return current.filter((entry) => entry !== trait);
      if (current.length >= 2) return current;
      return [...current, trait];
    });
  }

  function toggleExperience(id: string) {
    setExperiencePicks((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= 2) return current;
      return [...current, id];
    });
  }

  const valid =
    levelValid &&
    isValidPickCount(chosen) &&
    (!chosen.includes('traits') || traitPicks.length === 2) &&
    (!chosen.includes('experiences') || experiencePicks.length === 2) &&
    (!chosen.includes('domain-card') || domainPick !== null) &&
    (!chosen.includes('multiclass') ||
      (multiclassPick !== null &&
        multiclassDomainPick !== null &&
        multiclassSubclassPick !== null)) &&
    (!enteringTier || newExperience.trim().length > 0);

  function confirm() {
    if (!valid) return;
    let next: Sheet = {
      ...sheet,
      level: newLevel,
      updatedAt: new Date().toISOString(),
      advancements: [...chosen],
      advancementHistory: [
        ...(sheet.advancementHistory ?? []),
        ...chosen.map((advancement) => ({ level: newLevel, advancement })),
      ],
    };
    if (enteringTier) {
      next = {
        ...next,
        proficiency: next.proficiency + 1,
        experiences: [...next.experiences, { id: makeId('exp'), name: newExperience.trim(), modifier: 2 }],
      };
    }
    if (newLevel === 5 || newLevel === 8) {
      next = { ...next, traitMarks: [] };
    }
    for (const advance of chosen) {
      switch (advance) {
        case 'traits': {
          const traits = { ...next.traits };
          traitPicks.forEach((trait) => { traits[trait] = traits[trait] + 1; });
          next = { ...next, traits, traitMarks: [...next.traitMarks, ...traitPicks] };
          break;
        }
        case 'hp':
          next = { ...next, bonusHpSlots: next.bonusHpSlots + 1 };
          break;
        case 'stress':
          next = { ...next, bonusStressSlots: next.bonusStressSlots + 1 };
          break;
        case 'experiences':
          next = {
            ...next,
            experiences: next.experiences.map((experience) =>
              experiencePicks.includes(experience.id) ? { ...experience, modifier: experience.modifier + 1 } : experience,
            ),
          };
          break;
        case 'domain-card':
          if (domainPick) {
            next = {
              ...next,
              domainCardIds: [...next.domainCardIds, domainPick],
              loadoutIds: next.loadoutIds.length < 5 ? [...next.loadoutIds, domainPick] : next.loadoutIds,
            };
          }
          break;
        case 'evasion':
          next = { ...next, evasionBonus: next.evasionBonus + 1 };
          break;
        case 'subclass':
          next = { ...next, subclassUpgraded: Math.min(2, next.subclassUpgraded + 1) };
          break;
        case 'proficiency':
          next = { ...next, proficiency: next.proficiency + 1 };
          break;
        case 'multiclass':
          if (multiclassPick && multiclassDomainPick && multiclassSubclassPick) {
            next = {
              ...next,
              multiclassId: multiclassPick,
              multiclassDomain: multiclassDomainPick,
              multiclassSubclassId: multiclassSubclassPick,
              spellcastTraitOverride: spellcastPick ?? next.spellcastTraitOverride ?? null,
            };
          }
          break;
      }
    }
    onChange(next);
    onClose();
  }

  if (!levelValid) {
    return (
      <Overlay>
        <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-slate-100">Maximum level</h2>
          <p className="mt-2 text-sm text-slate-400">This character is already level 10.</p>
          <button type="button" onClick={onClose} className="mt-4 rounded-md bg-slate-800 px-4 py-2 text-sm text-slate-200">Close</button>
        </div>
      </Overlay>
    );
  }

  const slotLabel = hasDoubleSlot ? 'Uses both level-up slots' : `${chosen.length}/2 advancements chosen`;

  return (
    <Overlay>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Level up to {newLevel} <span className="text-sm font-normal text-slate-500">({tierLabel(newLevel)})</span></h2>
            <p className="mt-1 text-sm text-slate-400">
              Choose <strong className="text-slate-200">2 advancements</strong>. Multiclass and Proficiency each use both level-up slots on their own. Level and thresholds update automatically.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Close</button>
        </div>

        {enteringTier && (
          <div className="mt-4 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
            <p className="font-semibold">New tier — automatic bonuses</p>
            <p className="mt-1">+1 Proficiency and a new Experience at <strong>+2</strong>.{(newLevel === 5 || newLevel === 8) && ' All trait marks are cleared.'}</p>
            <input value={newExperience} onChange={(event) => setNewExperience(event.target.value)} placeholder="New Experience name" className="mt-2 w-full rounded-md border border-emerald-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100" />
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {ADVANCEMENTS.map((advance) => {
            const unavailable = optionUnavailable(advance);
            const selected = chosen.includes(advance.id);
            const doubleSlot = isDoubleSlotAdvancement(advance.id);
            const blockedByDouble = hasDoubleSlot && !selected && !doubleSlot;
            const disabledReason = unavailable ? (takenThisTier(advance.id) ? 'Already taken this tier' : '') : blockedByDouble ? 'Requires both slots' : '';
            return (
              <button
                key={advance.id}
                type="button"
                disabled={unavailable || (!selected && (doubleSlot ? (chosen.length >= 1 && !chosen.includes(advance.id) && hasDoubleSlot) : chosen.length >= 2))}
                onClick={() => toggleAdvance(advance.id)}
                className={`rounded-lg border p-3 text-left transition ${selected ? 'border-accent-400 bg-accent-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-500'} disabled:cursor-not-allowed disabled:opacity-35`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-slate-100">
                  {advance.title}
                  {doubleSlot && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-300">Both slots</span>}
                  {selected && <span className="text-accent-400">✓</span>}
                </span>
                <span className="mt-1 block text-xs text-slate-400">{advance.detail}</span>
                {newTier < advance.minTier && <span className="mt-1 block text-xs text-slate-500">Available from Tier {advance.minTier} (level 5+).</span>}
                {disabledReason && <span className="mt-1 block text-xs text-slate-500">{disabledReason}</span>}
              </button>
            );
          })}
        </div>

        {chosen.includes('traits') && (
          <Section title="Choose 2 unmarked traits">
            <div className="flex flex-wrap gap-2">
              {unmarkedTraits.map((trait) => (
                <Pill key={trait} selected={traitPicks.includes(trait)} onClick={() => toggleTrait(trait)}>
                  {TRAIT_LABELS[trait]} ({sheet.traits[trait]})
                </Pill>
              ))}
            </div>
            {unmarkedTraits.length === 0 && <p className="text-xs text-slate-500">No unmarked traits remain this tier.</p>}
          </Section>
        )}

        {chosen.includes('experiences') && (
          <Section title="Choose 2 Experiences for +1">
            <div className="flex flex-wrap gap-2">
              {sheet.experiences.map((experience) => (
                <Pill key={experience.id} selected={experiencePicks.includes(experience.id)} onClick={() => toggleExperience(experience.id)}>
                  {experience.name} (+{experience.modifier})
                </Pill>
              ))}
            </div>
          </Section>
        )}

        {chosen.includes('domain-card') && (
          <Section title={`Choose 1 domain card (level ≤ ${newLevel})`}>
            <p className="mb-2 text-xs text-slate-500">
              Cards from the multiclass domain are capped at level {Math.ceil(newLevel / 2)}. All other cards use your level.
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4 p-2">
              {domainOptions.map((card) => {
                const image = cardImage(card.id, 'domain');
                const capped = multiclassPick && card.domain === multiclassDomainPick ? Math.ceil(newLevel / 2) : newLevel;
                return (
                  <RuleCard key={card.id} src={image} title={card.name} selected={domainPick === card.id} onSelect={() => setDomainPick(card.id)}>
                    <CardText lines={[`${DOMAIN_LABELS[card.domain] ?? card.domain} · level ${card.level}/${capped} · ${card.type}`, card.text]} />
                  </RuleCard>
                );
              })}
              {domainOptions.length === 0 && <p className="text-xs text-slate-500">No eligible cards. Pick a domain you can access.</p>}
            </div>
          </Section>
        )}

        {chosen.includes('multiclass') && (
          <Section title="Multiclass: choose a second class (Core Rulebook p. 111)">
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              You gain the class feature of the new class, one domain you do not already have, and a foundation card from one of its subclasses. Domain cards from the new domain are limited to half your level (rounded up). You can multiclass only once, and you cannot gain a mastery subclass card afterward.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {multiclassOptions.map((entry) => (
                <Pill key={entry.id} selected={multiclassPick === entry.id} onClick={() => { setMulticlassPick(entry.id); setMulticlassDomainPick(null); setMulticlassSubclassPick(null); setSpellcastPick(null); }}>
                  {entry.name} ({entry.domains.join(' / ')})
                </Pill>
              ))}
            </div>

            {multiclassClass && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-sky-900/60 bg-sky-950/20 p-3">
                  <p className="text-xs font-semibold text-sky-200">Class feature: {multiclassClass.name}</p>
                  {multiclassClass.hopeFeature && <p className="mt-1 text-xs text-slate-300"><strong>Hope — {multiclassClass.hopeFeature.name}:</strong> {multiclassClass.hopeFeature.text}</p>}
                  {(multiclassClass.classFeatures ?? []).map((feature) => (
                    <p key={feature.name} className="mt-1 text-xs text-slate-400"><strong>{feature.name}:</strong> {feature.text}</p>
                  ))}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-300">One new domain (not already accessible)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {multiclassDomainOptions.map((domain) => (
                      <Pill key={domain} selected={multiclassDomainPick === domain} onClick={() => setMulticlassDomainPick(domain)}>
                        {DOMAIN_LABELS[domain] ?? domain} (cards ≤ level {Math.ceil(newLevel / 2)})
                      </Pill>
                    ))}
                  </div>
                  {multiclassDomainOptions.length === 0 && <p className="text-xs text-slate-500">This class shares both domains — pick a different class.</p>}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-300">Foundation card from a subclass</p>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4 p-2">
                    {multiclassClass.subclasses.map((subclass) => (
                      <RuleCard
                        key={subclass.id}
                        src={cardImage(`${subclass.id}-foundation`, 'subclass')}
                        title={`${multiclassClass.name} — ${subclass.name}`}
                        selected={multiclassSubclassPick === subclass.id}
                        onSelect={() => setMulticlassSubclassPick(subclass.id)}
                      >
                        <CardText lines={[subclass.description, ...subclass.foundation.map((feature) => `${feature.name}: ${feature.text}`)]} />
                      </RuleCard>
                    ))}
                  </div>
                </div>
                {spellcastOptions.length > 1 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-slate-300">Spellcast trait (choose one)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {spellcastOptions.map((trait) => (
                        <Pill key={trait} selected={spellcastPick === trait} onClick={() => setSpellcastPick(trait)}>
                          {TRAIT_LABELS[trait]} ({sheet.traits[trait]})
                        </Pill>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Leave unselected to keep your original subclass Spellcast trait.</p>
                  </div>
                )}
                {spellcastOptions.length === 1 && (
                  <p className="text-xs text-slate-400">Spellcast trait: <strong>{TRAIT_LABELS[spellcastOptions[0]!]}</strong> ({sheet.traits[spellcastOptions[0]!]}).</p>
                )}
              </div>
            )}
          </Section>
        )}

        {chosen.includes('subclass') && (
          <Section title="Subclass">
            <p className="text-xs text-slate-400">
              {sheet.subclassId
                ? `${getClass(sheet.classId)?.subclasses.find((entry) => entry.id === sheet.subclassId)?.name ?? 'Subclass'} advances to ${sheet.subclassUpgraded === 0 ? 'specialization' : 'mastery'}.`
                : 'No subclass selected.'}
            </p>
          </Section>
        )}

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <span className="mr-auto text-xs text-slate-500">{slotLabel}</span>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button type="button" disabled={!valid} onClick={confirm} className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40">Confirm level {newLevel}</button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs ${selected ? 'border-accent-400 bg-accent-500/10 text-accent-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}
    >
      {children}
    </button>
  );
}
