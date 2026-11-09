import { useEffect, useMemo, useRef, useState } from 'react';
import { RuleCard, CardText } from '../../components/RuleCard';
import type { TraitName, Traits } from '@daggery/shared';
import type { AncestryEntry, ClassEntry, CommunityEntry, SubclassEntry } from './rules';
import {
  STARTING_TRAIT_VALUES,
  TRAIT_LABELS,
  TRAIT_ORDER,
  cardImage,
  getAncestry,
  getArmor,
  getClass,
  getCommunity,
  getSubclass,
  getWeapon,
  hasStartingTraits,
  makeId,
  swapTraits,
  startingArmor,
  startingWeapons,
} from './rules';
import type { BackgroundAnswer, InventoryEntry, Sheet } from './types';
import { ancestries, classes, communities, domainCards } from '@daggery/content';

const STEPS = [
  'Character',
  'Ancestry',
  'Community',
  'Traits',
  'Equipment',
  'Experiences',
  'Domains',
  'History',
] as const;

interface WizardProps {
  author: string;
  onCreate: (sheet: Sheet) => void;
  onCancel: () => void;
}

function initialTraits(): Traits {
  const traits = {} as Traits;
  TRAIT_ORDER.forEach((trait, index) => {
    traits[trait] = STARTING_TRAIT_VALUES[index] ?? 0;
  });
  return traits;
}

export default function Wizard({ author, onCreate, onCancel }: WizardProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => { pageRef.current?.closest('main')?.scrollTo(0, 0); }, [step]);
  const [name, setName] = useState('');
  const [playerName, setPlayerName] = useState(author);
  const [classId, setClassId] = useState<string | null>(null);
  const [subclassId, setSubclassId] = useState<string | null>(null);
  const [ancestryId, setAncestryId] = useState<string | null>(null);
  const [mixedAncestry, setMixedAncestry] = useState(false);
  const [mixedAncestryId, setMixedAncestryId] = useState<string | null>(null);
  const [heritageName, setHeritageName] = useState('');
  const [ancestryFeatureOrder, setAncestryFeatureOrder] = useState<'primary-first' | 'mixed-first'>(
    'primary-first',
  );
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [traits, setTraits] = useState<Traits>(initialTraits);
  const [selectedTrait, setSelectedTrait] = useState<TraitName | null>(null);
  const [traitMessage, setTraitMessage] = useState('');
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [armorId, setArmorId] = useState<string | null>(null);
  const [potion, setPotion] = useState<'minor-health-potion' | 'minor-stamina-potion'>(
    'minor-health-potion',
  );
  const [exp1, setExp1] = useState('');
  const [exp2, setExp2] = useState('');
  const [domainPicks, setDomainPicks] = useState<string[]>([]);
  const [bgAnswers, setBgAnswers] = useState<Record<string, string>>({});
  const [connAnswers, setConnAnswers] = useState<Record<string, string>>({});

  const cls = getClass(classId);
  const subclass = getSubclass(classId, subclassId);
  const ancestry = getAncestry(ancestryId);
  const mixedAncestryEntry = getAncestry(mixedAncestryId);
  const mixedFeatures = (() => {
    if (!ancestry || !mixedAncestryEntry) return [];
    const pairs: [AncestryEntry, 0 | 1][] =
      ancestryFeatureOrder === 'primary-first'
        ? [
            [ancestry, 0],
            [mixedAncestryEntry, 1],
          ]
        : [
            [mixedAncestryEntry, 0],
            [ancestry, 1],
          ];
    return pairs.flatMap(([entry, index]) => {
      const feature = entry.features[index];
      return feature ? [{ name: feature.name, text: feature.text, source: entry.name }] : [];
    });
  })();
  const community = getCommunity(communityId);
  const primary = getWeapon(primaryId);
  const secondary = getWeapon(secondaryId);
  const equippedArmor = getArmor(armorId);
  const tierOneWeapons = useMemo(() => startingWeapons(), []);
  const tierOneArmor = useMemo(() => startingArmor(), []);
  const primaryOptions = tierOneWeapons.filter((weapon) => weapon.category === 'Primary');
  const secondaryOptions = tierOneWeapons.filter((weapon) => weapon.category === 'Secondary');
  const twoHanded = primary?.burden === 'Two-Handed';

  const domainOptions = useMemo(() => {
    if (!cls) return [];
    return domainCards.filter((card) => cls.domains.includes(card.domain) && card.level === 1);
  }, [cls]);

  function pickClass(nextClassId: string, nextSubclassId: string) {
    if (!getSubclass(nextClassId, nextSubclassId)) return;
    if (classId !== nextClassId) {
      setDomainPicks([]);
      setBgAnswers({});
      setConnAnswers({});
    }
    setClassId(nextClassId);
    setSubclassId(nextSubclassId);
  }

  function selectTrait(trait: TraitName) {
    if (selectedTrait === trait) {
      setSelectedTrait(null);
      setTraitMessage('Selection cleared.');
    } else if (selectedTrait) {
      setTraits((current) => swapTraits(current, selectedTrait, trait));
      setTraitMessage(`${TRAIT_LABELS[selectedTrait]} and ${TRAIT_LABELS[trait]} swapped values.`);
      setSelectedTrait(null);
    } else {
      setSelectedTrait(trait);
      setTraitMessage(`${TRAIT_LABELS[trait]} selected. Choose another trait to swap.`);
    }
  }

  function toggleDomainCard(id: string) {
    setDomainPicks((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= 2) return current;
      return [...current, id];
    });
  }

  const stepValid = (() => {
    switch (step) {
      case 0:
        return name.trim().length > 0 && !!subclass;
      case 1:
        return (
          ancestryId !== null &&
          (!mixedAncestry || (mixedAncestryId !== null && mixedAncestryId !== ancestryId))
        );
      case 2:
        return communityId !== null;
      case 3:
        return hasStartingTraits(traits);
      case 4:
        return primaryId !== null && armorId !== null && (!twoHanded || secondaryId === null);
      case 5:
        return exp1.trim().length > 0 && exp2.trim().length > 0;
      case 6:
        return domainPicks.length === 2;
      default:
        return true;
    }
  })();

  function createSheet() {
    if (!cls || !subclass || !primary || !equippedArmor) return;
    const now = new Date().toISOString();
    const background: BackgroundAnswer[] = cls.backgroundQuestions.map((question) => ({
      question,
      answer: bgAnswers[question] ?? '',
    }));
    const connections: BackgroundAnswer[] = cls.connections.map((question) => ({
      question,
      answer: connAnswers[question] ?? '',
    }));
    const potionName =
      potion === 'minor-health-potion' ? 'Minor Health Potion' : 'Minor Stamina Potion';
    const inventory: InventoryEntry[] = [
      { id: makeId('inv'), name: 'Torch', kind: 'item', qty: 1 },
      { id: makeId('inv'), name: 'Rope (15 m)', kind: 'item', qty: 1 },
      { id: makeId('inv'), name: 'Basic supplies', kind: 'item', qty: 1 },
      { id: makeId('inv'), name: potionName, kind: 'consumable', qty: 1 },
    ];
    if (cls.classItems) {
      inventory.push({
        id: makeId('inv'),
        name: 'Class items',
        kind: 'custom',
        qty: 1,
        description: cls.classItems,
      });
    }
    onCreate({
      id: makeId('sheet'),
      name: name.trim(),
      playerName: playerName.trim() || author,
      level: 1,
      proficiency: 1,
      classId: cls.id,
      subclassId,
      ancestryId,
      mixedAncestryId: mixedAncestry ? mixedAncestryId : null,
      ancestryFeatureOrder,
      heritageName: heritageName.trim() || null,
      spellcastTraitOverride: null,
      communityId,
      traits,
      traitMarks: [],
      evasionBonus: 0,
      armorId,
      armorSlotsMarked: 0,
      hpMarked: 0,
      stressMarked: 0,
      hope: 2,
      bonusHpSlots: 0,
      bonusStressSlots: 0,
      experiences: [
        { id: makeId('exp'), name: exp1.trim(), modifier: 2 },
        { id: makeId('exp'), name: exp2.trim(), modifier: 2 },
      ],
      weapons: [
        { weaponId: primary.id, slot: 'primary' },
        ...(secondary ? [{ weaponId: secondary.id, slot: 'secondary' as const }] : []),
      ],
      inventory,
      gold: 1,
      domainCardIds: domainPicks,
      loadoutIds: domainPicks,
      background,
      connections,
      notes: '',
      subclassUpgraded: 0,
      multiclassId: null,
      multiclassDomain: null,
      multiclassSubclassId: null,
      advancements: [],
      advancementHistory: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  return (
    <div ref={pageRef} className="character-wizard mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          ← Sheets
        </button>
        <h2 className="text-xl font-semibold text-slate-100">New character</h2>
        <span className="text-sm text-slate-500">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </span>
      </div>

      <ol className="mb-6 flex flex-wrap gap-1.5 text-xs">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-2.5 py-1 ${
              index === step
                ? 'bg-accent-500 font-semibold text-slate-950'
                : index < step
                  ? 'bg-slate-800 text-emerald-300'
                  : 'bg-slate-900 text-slate-500'
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-6">
        {step === 0 && (
          <section className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Character name">
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Kael, the Shadow"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </Field>
              <Field label="Player">
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </Field>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Choose your class and subclass</h3>
              <p className="mt-1 text-sm text-slate-400">
                Each class has two subclasses. You start with the foundation card of the chosen subclass.
              </p>
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] justify-center gap-4 p-2">
                {getClassOptionList().flatMap((entry) => entry.subclasses.map((option) => (
                  <SubclassOption
                    key={`${entry.id}:${option.id}`}
                    entry={option}
                    className={entry.name}
                    selected={classId === entry.id && subclassId === option.id}
                    onClick={() => pickClass(entry.id, option.id)}
                  />
                )))}
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Heritage</h3>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
                    Core Rulebook p. 71: pick one main ancestry below. For a mixed heritage, add a
                    second lineage and take the first feature of one ancestry and the second feature
                    of the other. Extra lineages beyond two are represented by appearance and
                    backstory only.
                  </p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={mixedAncestry}
                    onChange={(event) => {
                      setMixedAncestry(event.target.checked);
                      if (!event.target.checked) setMixedAncestryId(null);
                    }}
                    className="accent-[var(--ds-brand)]"
                  />
                  <span className="text-xs font-semibold text-slate-200">Mixed ancestry</span>
                </label>
              </div>

              <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2">
                <Field label="Heritage name (optional)">
                  <input
                    value={heritageName}
                    onChange={(event) => setHeritageName(event.target.value)}
                    placeholder="e.g. Goblin-Orc, Toothling, Horned Toad"
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </Field>
                {mixedAncestry && (
                  <Field label="Second ancestry">
                    <select
                      value={mixedAncestryId ?? ''}
                      onChange={(event) => setMixedAncestryId(event.target.value || null)}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="">— choose —</option>
                      {getAncestryList()
                        .filter((entry) => entry.id !== ancestryId)
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </div>

              {mixedAncestry && (
                <div className="mt-4 grid gap-4 border-t border-slate-800 pt-4 sm:grid-cols-2">
                  <fieldset>
                    <legend className="text-xs font-medium text-slate-400">Feature order</legend>
                    <div className="mt-1.5 space-y-1.5">
                      {(
                        [
                          ['primary-first', 'First feature from the main ancestry, second from the other'],
                          ['mixed-first', 'First feature from the other ancestry, second from the main'],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className="flex items-start gap-2 text-xs text-slate-300">
                          <input
                            type="radio"
                            name="ancestry-feature-order"
                            checked={ancestryFeatureOrder === value}
                            onChange={() => setAncestryFeatureOrder(value)}
                            className="mt-0.5"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Example: Goblin-Orc can take Surefooted (Goblin 1st) + Tusks (Orc 2nd), or
                      Sturdy (Orc 1st) + Danger Sense (Goblin 2nd) — but never both first features.
                    </p>
                  </fieldset>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-semibold text-slate-300">Selected features</p>
                    {mixedFeatures.length === 2 ? (
                      <ul className="mt-1.5 space-y-2 text-xs text-slate-400">
                        {mixedFeatures.map((feature, index) => (
                          <li key={feature.name}>
                            <span className="mr-1 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-slate-300">
                              {index === 0 ? '1st' : '2nd'}
                            </span>
                            <strong className="text-slate-200">{feature.name}</strong>{' '}
                            <span className="text-slate-500">({feature.source})</span> — {feature.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        Choose a main ancestry below{ancestryId ? ' and a second ancestry above' : ''}.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] justify-center gap-4 p-2">
              {getAncestryList().map((entry) => (
                <CardOption
                  key={entry.id}
                  selected={ancestryId === entry.id}
                  onClick={() => {
                    setAncestryId(entry.id);
                    if (mixedAncestryId === entry.id) setMixedAncestryId(null);
                  }}
                  title={entry.name}
                  image={cardImage(entry.id, 'ancestry')}
                  lines={entry.features.map((feature) => `${feature.name}: ${feature.text}`)}
                />
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] justify-center gap-4 p-2">
            {getCommunityList().map((entry) => (
              <CardOption
                key={entry.id}
                selected={communityId === entry.id}
                onClick={() => setCommunityId(entry.id)}
                title={entry.name}
                image={cardImage(entry.id, 'community')}
                lines={entry.features.map((feature) => `${feature.name}: ${feature.text}`)}
              />
            ))}
          </section>
        )}

        {step === 3 && (
          <section className="mx-auto max-w-3xl">
            <h3 className="text-lg font-semibold text-slate-100">Distribute your traits</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              The starting values are already assigned. Select two traits to swap their values.
            </p>
            <p className="mt-3 text-sm text-slate-400">
              Starting values: <strong className="font-semibold text-slate-200">+2, +1, +1, 0, 0, −1</strong>
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2" aria-label="Character traits">
              {TRAIT_ORDER.map((trait) => (
                <button
                  key={trait}
                  type="button"
                  aria-pressed={selectedTrait === trait}
                  onClick={() => selectTrait(trait)}
                  className={`flex min-h-16 items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors ${
                    selectedTrait === trait
                      ? 'border-[var(--ds-brand)] bg-accent-500/10'
                      : 'border-slate-700 bg-slate-950 hover:border-accent-400'
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-100">{TRAIT_LABELS[trait]}</span>
                  <span className={`grid h-10 min-w-10 place-items-center rounded-md px-2 text-lg font-bold tabular-nums ${selectedTrait === trait ? 'bg-[var(--ds-brand)] text-[var(--ds-on-brand)]' : 'bg-slate-800 text-slate-100'}`}>
                    {traits[trait] > 0 ? `+${traits[trait]}` : traits[trait]}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-4 min-h-5 text-sm text-slate-400" role="status" aria-live="polite">
              {traitMessage || 'Select a trait to start swapping.'}
            </p>
          </section>
        )}

        {step === 4 && (
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Primary weapon (Tier 1)">
                <select
                  value={primaryId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    setPrimaryId(value);
                    const picked = getWeapon(value);
                    if (picked?.burden === 'Two-Handed') setSecondaryId(null);
                  }}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="">— choose —</option>
                  {primaryOptions.map((weapon) => (
                    <option key={weapon.id} value={weapon.id}>
                      {weapon.name} · {weapon.trait} · {weapon.damage} {weapon.damageType} ·{' '}
                      {weapon.burden}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Secondary weapon (optional, only with a one-handed primary)">
                <select
                  value={secondaryId ?? ''}
                  disabled={!primaryId || twoHanded}
                  onChange={(event) => setSecondaryId(event.target.value || null)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-40"
                >
                  <option value="">— none —</option>
                  {secondaryOptions.map((weapon) => (
                    <option key={weapon.id} value={weapon.id}>
                      {weapon.name} · {weapon.trait} · {weapon.damage} {weapon.damageType}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-slate-500">
                Rule: a two-handed primary weapon, or a one-handed primary + a secondary.
              </p>
            </div>
            <div className="space-y-4">
              <Field label="Armor (Tier 1)">
                <select
                  value={armorId ?? ''}
                  onChange={(event) => setArmorId(event.target.value || null)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="">— choose —</option>
                  {tierOneArmor.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · Thresholds {entry.baseThresholds.major}/
                      {entry.baseThresholds.severe} · Score {entry.baseScore}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Starting potion">
                <div className="flex gap-2">
                  <PillButton
                    selected={potion === 'minor-health-potion'}
                    onClick={() => setPotion('minor-health-potion')}
                  >
                    Minor Health Potion (1d4 HP)
                  </PillButton>
                  <PillButton
                    selected={potion === 'minor-stamina-potion'}
                    onClick={() => setPotion('minor-stamina-potion')}
                  >
                    Minor Stamina Potion (1d4 Stress)
                  </PillButton>
                </div>
              </Field>
              {primary && (
                <InfoBox>
                  <strong>{primary.name}</strong>: {primary.trait}, {primary.range} range, damage{' '}
                  {primary.damage} ({primary.damageType}), {primary.burden}.
                  {primary.feature && (
                    <span className="block text-slate-400">
                      {primary.feature.name}: {primary.feature.text}
                    </span>
                  )}
                </InfoBox>
              )}
              {secondary && (
                <InfoBox>
                  <strong>{secondary.name}</strong>: {secondary.trait}, damage {secondary.damage}.
                </InfoBox>
              )}
              {equippedArmor && (
                <InfoBox>
                  <strong>{equippedArmor.name}</strong>: Armor Score {equippedArmor.baseScore},{' '}
                  thresholds {equippedArmor.baseThresholds.major}/
                  {equippedArmor.baseThresholds.severe}.
                  {equippedArmor.feature && (
                    <span className="block text-slate-400">
                      {equippedArmor.feature.name}: {equippedArmor.feature.text}
                    </span>
                  )}
                </InfoBox>
              )}
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-4">
            <p className="text-sm text-slate-400">
              Create two specific Experiences. Both start at <strong>+2</strong> and can be used
              by spending 1 Hope before a roll.
            </p>
            <Field label="Experience 1">
              <input
                value={exp1}
                onChange={(event) => setExp1(event.target.value)}
                placeholder="e.g. Sapphire Guild Assassin"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </Field>
            <Field label="Experience 2">
              <input
                value={exp2}
                onChange={(event) => setExp2(event.target.value)}
                placeholder="e.g. Sand Wanderer"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </Field>
          </section>
        )}

        {step === 6 && (
          <section>
            <p className="mb-4 text-sm text-slate-400">
              Choose <strong>2 level 1 domain cards</strong> from your class domains (
              {cls?.domains.join(' / ')}). They enter your starting loadout.
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4 p-2">
              {domainOptions.map((card) => (
                <CardOption
                  key={card.id}
                  selected={domainPicks.includes(card.id)}
                  onClick={() => toggleDomainCard(card.id)}
                  title={card.name}
                  subtitle={`${card.domain} · level ${card.level} · ${card.type} · recall ${card.recallCost}`}
                  image={cardImage(card.id, 'domain')}
                  lines={[card.text]}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Selected: {domainPicks.length}/2</p>
          </section>
        )}

        {step === 7 && cls && (
          <section className="mx-auto max-w-3xl">
            <h3 className="text-lg font-semibold text-slate-100">History and connections</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Use these questions to imagine your character and their ties to the group. This step is optional and you can leave answers blank.
            </p>
            <div className="mt-7 space-y-8">
              <NarrativeQuestions title="History" description="Your character's past." questions={cls.backgroundQuestions} answers={bgAnswers} onChange={setBgAnswers} />
              <NarrativeQuestions title="Connections with the group" description="How your character relates to the others." questions={cls.connections} answers={connAnswers} onChange={setConnAnswers} />
            </div>
          </section>
        )}
      </div>

      <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-3 rounded-t-lg border border-[var(--ds-border)] bg-[var(--ds-raised)] p-3 shadow-lg">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => {
            if (step === 3) { setSelectedTrait(null); setTraitMessage(''); }
            setStep((current) => Math.max(0, current - 1));
          }}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          {!stepValid && (
            <span className="text-xs text-accent-400 max-sm:sr-only">
              {step === 4 && twoHanded
                ? 'Choose armor and a primary weapon (secondary stays empty with a two-handed weapon).'
                : 'Complete the choices for this step.'}
            </span>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!stepValid}
              onClick={() => {
                if (step === 3) { setSelectedTrait(null); setTraitMessage(''); }
                setStep((current) => Math.min(STEPS.length - 1, current + 1));
              }}
              className="rounded-md bg-accent-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-accent-400 disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              disabled={!cls || !subclass || !primary || !equippedArmor}
              onClick={createSheet}
              className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Create sheet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getClassOptionList(): ClassEntry[] {
  return classes;
}

function getAncestryList(): AncestryEntry[] {
  return ancestries;
}

function getCommunityList(): CommunityEntry[] {
  return communities;
}

function NarrativeQuestions({ title, description, questions, answers, onChange }: {
  title: string;
  description: string;
  questions: string[];
  answers: Record<string, string>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <section>
      <div className="border-b border-slate-700 pb-3">
        <h4 className="text-base font-semibold text-slate-100">{title}</h4>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      <div className="mt-5 space-y-6">
        {questions.map((question) => (
          <label key={question} className="block space-y-2">
            <span className="block max-w-[70ch] text-sm font-medium leading-relaxed text-slate-200">{question}</span>
            <textarea
              rows={2}
              value={answers[question] ?? ''}
              onChange={(event) => onChange((current) => ({ ...current, [question]: event.target.value }))}
              placeholder="Write your answer if you like..."
              className="block min-h-20 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function SubclassOption({
  entry,
  className,
  selected,
  onClick,
}: {
  entry: SubclassEntry;
  className: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <CardOption title={`${className} — ${entry.name}`} subtitle="Foundation"
      image={cardImage(`${entry.id}-foundation`, 'subclass')}
      lines={[entry.description, ...entry.foundation.map((feature) => `${feature.name}: ${feature.text}`)]}
      selected={selected} onClick={onClick} />
  );
}

function CardOption({
  title,
  subtitle,
  lines,
  image,
  selected,
  onClick,
}: {
  title: string;
  subtitle?: string;
  lines: string[];
  image?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <RuleCard src={image} title={title} selected={selected} onSelect={onClick}>
      <CardText lines={[...(subtitle ? [subtitle] : []), ...lines]} />
    </RuleCard>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
      {children}
    </div>
  );
}

function PillButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-xs ${
        selected
          ? 'border-accent-400 bg-accent-500/10 text-accent-200'
          : 'border-slate-700 text-slate-300 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}
