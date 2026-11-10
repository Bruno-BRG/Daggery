import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Advantage, RollPayload, TraitName } from '@daggery/shared';
import { isSuccess, maxDiceTotal } from '@daggery/shared';
import { useDiceTray } from '../../dice3d';
import {
  DOMAIN_LABELS,
  MAX_HOPE,
  MAX_LOADOUT,
  SEVERITY_LABELS,
  TRAIT_LABELS,
  TRAIT_ORDER,
  ancestryFeatures,
  armorScore,
  classArt,
  clearArmor,
  clearHp,
  clearStress,
  damageHp,
  damageNotation,
  damageSeverity,
  damageThresholds,
  evasion,
  getAncestry,
  getArmor,
  getClass,
  getCommunity,
  getDomainCard,
  getSubclass,
  heritageBonuses,
  heritageDisplayName,
  hpMax,
  markStress,
  multiclassCardCap,
  multiclassDomain,
  spellcastTraitName,
  spellcastTraitOptions,
  stressMax,
  tierForLevel,
  tierLabel,
  weaponForSlot,
  weaponModifier,
  applyDualityEffects,
  type ArmorStats,
  type WeaponStats,
} from './rules';
import { ancestries } from '@daggery/content';
import { sendRoll } from '../../sync/rollSocket';
import { addFear, useSyncStatus } from '../../sync/store';
import LevelUpDialog from './LevelUpDialog';
import type { InventoryKind, Sheet } from './types';
import './sheet.css';
import { Icon, type IconName } from '../../components/Icon';
import { Dialog } from '../../components/Dialog';
import { ResourceCard } from './ResourceCard';
import { AbilityCard } from './AbilityCard';
import { ItemGlyph } from './ItemGlyph';
import { EquipmentPicker } from './EquipmentPicker';
import { equipEquipment, inventoryEquipmentId, inventoryEquipmentSlot, secondaryBlocked, type EquipmentSlot } from './equipment';
import { addInventoryItem, catalogInventoryItem, INVENTORY_KIND_LABELS } from './inventory';
import './sessionSheet.css';
import { useSoloAssistance } from '../../systems/useSoloAssistance';
import { ExportPdfDialog } from './ExportPdfDialog';
import { CharacterImagesDialog } from './CharacterImagesDialog';
import { portraitImage } from './appearance';

interface SheetViewProps {
  sheet: Sheet;
  author: string;
  onBack: () => void;
  onChange: (next: Sheet) => void;
  onDelete: () => void;
  onPlay?: () => void;
  backLabel?: string;
}

type AdvantageChoice = 'normal' | Advantage;
type TabId = 'play' | 'features' | 'equipment' | 'details';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'features', label: 'Effects & Features' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'details', label: 'Story' },
];

export default function SheetView({ sheet, author, onBack, onChange, onDelete, onPlay, backLabel = 'All characters' }: SheetViewProps) {
  const { roll } = useDiceTray();
  const assistance = useSoloAssistance(sheet.id);
  const sheetRef = useRef(sheet);
  useEffect(() => { sheetRef.current = sheet; }, [sheet]);

  const mutate = useCallback(
    (update: (current: Sheet) => Sheet) => {
      const next = update(sheetRef.current);
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      sheetRef.current = stamped;
      onChange(stamped);
    },
    [onChange],
  );

  const [advantage, setAdvantage] = useState<AdvantageChoice>('normal');
  const [difficulty, setDifficulty] = useState('');
  const [experienceId, setExperienceId] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [rolling, setRolling] = useState(false);
  const [incoming, setIncoming] = useState('');
  const [useArmorSlot, setUseArmorSlot] = useState(true);
  const [directDamage, setDirectDamage] = useState(false);
  const [withAllies, setWithAllies] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [inventoryAddOpen, setInventoryAddOpen] = useState(false);
  const [inventoryReturnSlot, setInventoryReturnSlot] = useState<EquipmentSlot|null>(null);
  const [inventoryAddKind, setInventoryAddKind] = useState<InventoryKind|'all'>('all');
  const [inventoryAddQuery, setInventoryAddQuery] = useState('');
  const [inventoryMessage, setInventoryMessage] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryKind|'all'>('all');
  const [tab, setTab] = useState<TabId>('play');
  const [editingHeritage, setEditingHeritage] = useState(false);
  const [vaultDomain, setVaultDomain] = useState<string>('all');
  const [recovery, setRecovery] = useState<'damage' | 'rest' | null>(null);
  const [recoveryResult, setRecoveryResult] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [abilitySearch, setAbilitySearch] = useState('');
  const [focused, setFocused] = useState(false);
  const [equipmentSlot, setEquipmentSlot] = useState<EquipmentSlot|null>(null);
  const connection = useSyncStatus();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  useEffect(() => {
    if (!focused) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLElement && event.target.closest('dialog[open]'))) setFocused(false);
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [focused]);

  const cls = getClass(sheet.classId);
  const subclass = getSubclass(sheet.classId, sheet.subclassId);
  const ancestry = getAncestry(sheet.ancestryId);
  const mixedAncestry = getAncestry(sheet.mixedAncestryId);
  const heritage = ancestryFeatures(sheet);
  const bonuses = heritageBonuses(sheet);
  const community = getCommunity(sheet.communityId);
  const equippedArmor = getArmor(sheet.armorId, sheet);
  const primary = weaponForSlot(sheet, 'primary');
  const secondary = weaponForSlot(sheet, 'secondary');
  const multiclass = getClass(sheet.multiclassId);
  const multiclassSubclass = getSubclass(sheet.multiclassId, sheet.multiclassSubclassId);
  const multiclassDomainId = multiclassDomain(sheet);
  const thresholds = damageThresholds(sheet);
  const currentArmorScore = armorScore(sheet);
  const currentHpMax = hpMax(sheet);
  const currentStressMax = stressMax(sheet);
  const currentEvasion = evasion(sheet);
  const tier = tierForLevel(sheet.level);
  const spellcastTrait = spellcastTraitName(sheet);
  const spellcastOptions = spellcastTraitOptions(sheet);

  const loadout = useMemo(
    () => sheet.loadoutIds.map((id) => getDomainCard(id)).filter((card): card is NonNullable<ReturnType<typeof getDomainCard>> => !!card),
    [sheet.loadoutIds],
  );
  const vault = useMemo(
    () => sheet.domainCardIds.filter((id) => !sheet.loadoutIds.includes(id)).map((id) => getDomainCard(id)).filter((card): card is NonNullable<ReturnType<typeof getDomainCard>> => !!card),
    [sheet.domainCardIds, sheet.loadoutIds],
  );
  const vaultFiltered = vaultDomain === 'all' ? vault : vault.filter((card) => card.domain === vaultDomain);
  const vaultDomains = [...new Set(vault.map((card) => card.domain))].sort();

  const selectedExperience = sheet.experiences.find((entry) => entry.id === experienceId);
  const experienceModifier = selectedExperience?.modifier ?? 0;
  const armorSlotAvailable = currentArmorScore > sheet.armorSlotsMarked;

  function openRecovery(kind: 'damage' | 'rest') { setRecoveryResult(''); setRecovery(kind); }

  function pushMessage(...lines: string[]) {
    if (recovery) setRecoveryResult(lines[0] ?? '');
    setMessages((current) => [...lines, ...current].slice(0, 8));
  }

  function forward(payload: RollPayload) {
    sendRoll({ type: 'roll', author, ...payload });
    return payload;
  }

  function failedRoll(error: unknown) {
    setRolling(false);
    pushMessage(error instanceof Error ? error.message : 'Roll failed.');
  }

  async function rollDuality(
    modifier: number,
    label: string,
    options: { damage?: string; spendExperience?: boolean } = {},
  ) {
    if (options.spendExperience && sheetRef.current.hope < 1) {
      pushMessage('Not enough Hope to use an Experience (costs 1 Hope).');
      return;
    }
    setRolling(true);
    let rollAdvantage: Advantage | undefined;
    try { rollAdvantage = await assistance.consume(advantage === 'normal' ? undefined : advantage); }
    catch (error) { failedRoll(error); return; }
    if (options.spendExperience) {
      mutate((current) => ({ ...current, hope: Math.max(0, current.hope - 1) }));
    }
    setRolling(true);
    const target = Number.parseInt(difficulty, 10);
    const hasDifficulty = difficulty.trim() !== '' && Number.isFinite(target);
    void roll(
      { kind: 'duality', modifier, advantage: rollAdvantage },
      {
        author,
        onComputed: (payload) => {
          forward(payload);
          if (payload.kind !== 'duality') { setRolling(false); return; }
          const result = payload.result;
          const effects = applyDualityEffects(sheetRef.current, result);
          mutate(() => effects.sheet);
          if (result.withFear) addFear(1);
          const success = hasDifficulty ? isSuccess(result, target) : null;
          const advantageText = result.advantageDie !== null ? ` ${result.advantage === 'advantage' ? '+' : '−'}d6 ${result.advantageDie}` : '';
          setMessages((current) => [`${label}: Hope ${result.hope} + Fear ${result.fear}${advantageText}${result.modifier === 0 ? '' : ` ${result.modifier > 0 ? '+' : ''}${result.modifier}`} = ${result.total}${success === null ? '' : success ? ' · SUCCESS' : ' · FAILURE'}`, `${label}: ${effects.notes.join(' · ')}`, ...current].slice(0, 8));
          if (options.damage && success !== false) {
            const notation = options.damage;
            const criticalBonus = result.critical ? maxDiceTotal(notation) : 0;
            void roll(
              { kind: 'dice', notation },
              {
                author,
                onComputed: (damagePayload) => {
                  forward(damagePayload);
                  if (damagePayload.kind === 'dice') {
                    const rolled = damagePayload.result.total;
                    pushMessage(criticalBonus > 0 ? `Critical damage: ${notation} = ${rolled} + ${criticalBonus} (maximum dice) = ${rolled + criticalBonus}` : `Damage: ${notation} = ${rolled}`);
                  }
                },
              },
            ).catch(failedRoll);
          }
          setRolling(false);
        },
      },
    ).catch(failedRoll);
  }

  function rollTrait(trait: TraitName) {
    const modifier = sheetRef.current.traits[trait] + experienceModifier;
    rollDuality(modifier, `${TRAIT_LABELS[trait]} roll`, { spendExperience: selectedExperience !== undefined });
  }

  function attack(weapon: WeaponStats) {
    const modifier = weaponModifier(sheetRef.current, weapon) + experienceModifier;
    const notation = damageNotation(weapon.damage, sheetRef.current.proficiency);
    rollDuality(modifier, `Attack · ${weapon.name}`, { damage: notation, spendExperience: selectedExperience !== undefined });
  }

  function shortRest(kind: 'hp' | 'stress' | 'armor') {
    const notation = `1d4+${tier}`;
    const labels = { hp: 'HP', stress: 'Stress', armor: 'armor slots' } as const;
    void roll(
      { kind: 'dice', notation },
      {
        author,
        onComputed: (payload) => {
          forward(payload);
          if (payload.kind !== 'dice') return;
          const amount = payload.result.total;
          if (kind === 'hp') mutate((current) => clearHp(current, amount));
          if (kind === 'stress') mutate((current) => clearStress(current, amount));
          if (kind === 'armor') mutate((current) => clearArmor(current, amount));
          pushMessage(`Short rest — clears ${amount} ${labels[kind]} (1d4 + tier). GM gains 1d4 Fear.`);
        },
      },
    ).catch(failedRoll);
  }

  function prepareRest(multiplier: number, rest: 'short' | 'long') {
    mutate((current) => ({ ...current, hope: Math.min(MAX_HOPE, current.hope + multiplier) }));
    pushMessage(`${rest === 'short' ? 'Short rest' : 'Long rest'} — Prepare: +${multiplier} Hope.`);
  }

  function applyDamage() {
    const amount = Number.parseInt(incoming, 10);
    if (!Number.isFinite(amount) || amount < 0) { pushMessage('Enter a valid damage amount.'); return; }
    const severity = damageSeverity(amount, damageThresholds(sheetRef.current));
    const canUseArmor = useArmorSlot && !directDamage && armorSlotAvailable;
    const hp = damageHp(severity, canUseArmor);
    mutate((current) => {
      let next = { ...current, hpMarked: Math.min(hpMax(current), current.hpMarked + hp) };
      if (canUseArmor) next = { ...next, armorSlotsMarked: Math.min(armorScore(current), next.armorSlotsMarked + 1) };
      return next;
    });
    const notes = [
      `${amount} damage (${SEVERITY_LABELS[severity]}) → ${hp} HP`,
      canUseArmor ? '1 Armor Slot marked (reduces one step)' : directDamage ? 'Direct damage: armor ignored' : 'No armor used',
    ];
    if (sheetRef.current.hpMarked + hp >= currentHpMax) notes.push('Last HP marked: make a Death Move!');
    pushMessage(notes.join(' · '));
    setIncoming('');
  }

  function recallCard(cardId: string) {
    const card = getDomainCard(cardId);
    if (!card) return;
    if (sheetRef.current.loadoutIds.length >= MAX_LOADOUT) { pushMessage(`Loadout full (${MAX_LOADOUT}). Stash a card before recalling another.`); return; }
    mutate((current) => {
      const withStress = markStress(current, card.recallCost);
      return { ...withStress, loadoutIds: [...withStress.loadoutIds, cardId] };
    });
    pushMessage(`${card.name} recalled from the vault${card.recallCost > 0 ? ` (marks ${card.recallCost} Stress)` : ''}.`);
  }

  function stashCard(cardId: string) {
    mutate((current) => ({ ...current, loadoutIds: current.loadoutIds.filter((id) => id !== cardId) }));
  }

  function openInventoryAdder(slot?: EquipmentSlot, query = '') {
    setInventoryAddQuery(query);
    setInventoryMessage('');
    setInventoryReturnSlot(slot??null);
    setInventoryAddKind(slot==='armor'?'armor':slot?'weapon':'all');
    setEquipmentSlot(null);
    setInventoryAddOpen(true);
  }

  function closeInventoryAdder() {
    setInventoryAddOpen(false);
    if (inventoryReturnSlot) setEquipmentSlot(inventoryReturnSlot);
    setInventoryReturnSlot(null);
  }

  function changeQty(id: string, delta: number) {
    mutate((current) => ({ ...current, inventory: current.inventory.map((entry) => entry.id === id ? { ...entry, qty: Math.max(0, entry.qty + delta) } : entry) }));
  }

  function removeItem(id: string) {
    mutate((current) => ({ ...current, inventory: current.inventory.filter((entry) => entry.id !== id) }));
  }

  const filteredInventory = sheet.inventory.filter(entry=>entry.qty>0&&(inventoryFilter==='all'||entry.kind===inventoryFilter)&&`${entry.name} ${entry.description??''}`.toLowerCase().includes(inventoryQuery.toLowerCase()));
  const hpRemaining = currentHpMax - sheet.hpMarked;
  const stressRemaining = currentStressMax - sheet.stressMarked;
  const art = classArt(sheet.classId);
  const heritageLine = [heritage.length > 0 ? heritageDisplayName(sheet) : null, community?.name ?? null].filter(Boolean).join(' · ');

  return (
    <div className={`sheet-page character-folio ${focused ? 'is-focused' : ''}`}>
      <header className="sheet-toolbar folio-toolbar">
        <button type="button" onClick={onBack} className="sheet-ghost" aria-label={backLabel}><Icon name="arrow" /><span className="folio-back-label">{backLabel}</span></button>
        <span className="folio-toolbar-label">{focused ? sheet.name : 'CHARACTER SHEET'}</span>{focused && <span role="status" className={`sheet-session-connection ${connection === 'open' ? 'is-connected' : ''}`}><i />{connection === 'open' ? 'Connected' : 'Reconnecting…'}</span>}
        <div className="sheet-toolbar-actions"><button type="button" onClick={() => setExportOpen(true)} className="sheet-ghost sheet-export-trigger" aria-label="Export character PDF"><Icon name="pdf" /><span>PDF</span></button>{onPlay && <button type="button" className="sheet-ghost sheet-focus-toggle" aria-label={focused ? 'Exit focused sheet view' : 'Focus character sheet'} title={focused ? 'Back to campaign (Escape)' : 'Focus sheet for play'} aria-pressed={focused} onClick={() => setFocused(value => !value)}><Icon name={focused ? 'shrink' : 'expand'} /><span>{focused ? 'Exit focus' : 'Focus'}</span></button>}{onPlay && <button type="button" onClick={onPlay} className="sheet-ghost" title="Bring this character to the current scene"><Icon name="map" /><span>Table</span></button>}<button type="button" aria-label="Rest" onClick={() => openRecovery('rest')} className="sheet-ghost"><Icon name="moon" /><span>Rest</span></button><button type="button" onClick={() => setShowLevelUp(true)} disabled={sheet.level >= 10} className="sheet-primary"><Icon name="spark" />Level up</button><button type="button" onClick={() => setActionsOpen(true)} className="sheet-ghost folio-more" aria-label="Character actions"><Icon name="more" /></button></div>
      </header>

      <section className={`sheet-hero ${sheet.bannerUrl ? 'has-character-banner' : ''}`}>
        {sheet.bannerUrl ? <img className="character-banner" src={sheet.bannerUrl} alt="" /> : art && <div className="sheet-hero-bg" style={{ backgroundImage: `url("${art}")` }} aria-hidden="true" />}
        <div className="sheet-hero-top">
          <button type="button" className="sheet-portrait character-portrait-button" aria-label="Edit character images" title="Edit portrait, banner, and token" onClick={() => setImagesOpen(true)}>
            {portraitImage(sheet) ? <img src={portraitImage(sheet)} alt="" /> : <Icon name="image" />}
          </button>
          <div className="sheet-identity">
            <p className="sheet-eyebrow"><span className="folio-hero-spark" aria-hidden="true">✦</span>{cls?.name ?? sheet.classId}{subclass ? ` · ${subclass.name}` : ''}</p>
            <input value={sheet.name} onChange={(event) => mutate((current) => ({ ...current, name: event.target.value }))} className="sheet-name" aria-label="Character name" />
            <p className="sheet-subtitle">{heritageLine || 'No heritage defined'}</p>
            <div className="sheet-badges">
              <Badge label={`Proficiency ${sheet.proficiency}`} tone="slate" />
              <Badge label={`Player: ${sheet.playerName}`} tone="slate" />
              {mixedAncestry && <Badge label="Mixed ancestry" tone="accent" />}
              {multiclass && <Badge label={`Multiclass: ${multiclass.name}`} tone="sky" />}
            </div>
          </div>
          <div className="sheet-shields">
            <Shield label="Evasion" value={currentEvasion} hint={armorHint(equippedArmor)} />
            
          </div>
          <div className="sheet-level"><span>{sheet.level}</span><small>Level</small></div>
        </div>

      </section>
      <div className="folio-resources">
        <ResourceCard label="Hit Points" icon="heart" count={sheet.hpMarked} max={currentHpMax} tone="health" onChange={value => mutate(current => ({ ...current, hpMarked: value }))} />
        <ResourceCard label="Stress" icon="stress" count={sheet.stressMarked} max={currentStressMax} tone="stress" onChange={value => mutate(current => ({ ...current, stressMarked: value }))} />
        <ResourceCard label="Hope" icon="spark" count={sheet.hope} max={MAX_HOPE} tone="hope" positive onChange={value => mutate(current => ({ ...current, hope: value }))} />
        <ResourceCard label="Armor" icon="armor" count={sheet.armorSlotsMarked} max={currentArmorScore} tone="armor" onChange={value => mutate(current => ({ ...current, armorSlotsMarked: value }))} />
      </div>
      <section className="folio-traits" aria-label="Action rolls"><div className="folio-traits-heading"><h2><Icon name="dice" />Make your move</h2><span>Choose a trait to roll Duality</span>{rolling && <span role="status">Rolling…</span>}</div>
        <div className="sheet-trait-row">
          {TRAIT_ORDER.map((trait) => (
            <button key={trait} type="button" disabled={rolling} onClick={() => rollTrait(trait)} className="sheet-trait" title={`Roll ${TRAIT_LABELS[trait]}`}>
              <span className="sheet-trait-label"><Icon name={({agility:'agility',strength:'strength',finesse:'hand',instinct:'eye',presence:'presence',knowledge:'knowledge'} as Record<TraitName,IconName>)[trait]} />{TRAIT_LABELS[trait]}</span>
              <span className="sheet-trait-value">{sheet.traits[trait] >= 0 ? '+' : ''}{sheet.traits[trait]}</span>
              <span className="sheet-trait-actions">{TRAIT_ACTIONS[trait].join(' · ')}</span>
            </button>
          ))}
        </div>
      </section>

      <details className="folio-roll-settings"><summary><Icon name="settings" /><strong>Roll settings</strong><span>{advantage === 'normal' ? 'Normal roll' : advantage === 'advantage' ? 'With advantage' : 'With disadvantage'}{selectedExperience ? ` · ${selectedExperience.name} (+${experienceModifier})` : ''}{difficulty ? ` · Difficulty ${difficulty}` : ''}</span><Icon name="chevron" /></summary><div className="folio-roll-controls">
              <div>
                <p className="sheet-mini-label">Advantage</p>
                <div className="sheet-seg">
                  {([['normal', 'Normal'], ['advantage', 'Advantage'], ['disadvantage', 'Disadvantage']] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setAdvantage(value)} className={advantage === value ? 'is-active' : ''}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="sheet-field-row">
                <label className="sheet-field">Difficulty<input type="number" value={difficulty} onChange={(event) => setDifficulty(event.target.value)} placeholder="e.g. 14" /></label>
                <label className="sheet-field">Experience<select value={experienceId} onChange={(event) => setExperienceId(event.target.value)}><option value="">— none —</option>{sheet.experiences.map((experience) => <option key={experience.id} value={experience.id}>{experience.name} (+{experience.modifier})</option>)}</select></label>
              </div>
              <p className="sheet-note">Select a trait above to roll.</p>
            </div></details>
      {messages.length > 0 && <div className="folio-result-banner" role="status"><Icon name="dice" /><span>{messages[0]}</span></div>}
      <nav className="sheet-tabs" role="tablist" aria-label="Character sheet sections" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.findIndex(item => item.id === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        setTab(TABS[next]!.id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" id={`folio-tab-${item.id}`} aria-controls="folio-tab-panel" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`sheet-tab ${tab === item.id ? 'is-active' : ''}`}>
            <Icon name={({ play: 'dice', features: 'spark', equipment: 'backpack', details: 'book' } as Record<TabId, IconName>)[item.id]} /><span className={item.id === 'features' ? 'folio-tab-full' : ''}>{item.label}</span>{item.id === 'features' && <><span className="folio-tab-short">Abilities</span><span className="folio-tab-count">{loadout.length}</span></>}
          </button>
        ))}
      </nav>

      <div id="folio-tab-panel" role="tabpanel" aria-labelledby={`folio-tab-${tab}`}>
      {tab === 'play' && (
        <div className="sheet-play">
          <div className="sheet-col">
          <section className="sheet-panel">
            <PanelHead title="Defense & recovery" icon="shield" />
            <div className="sheet-threshold-strip">
              <Threshold label="Major" value={thresholds.major} note="2 HP" />
              <Threshold label="Severe" value={thresholds.severe} note="3 HP" />
              <Threshold label="Massive" value={thresholds.severe * 2} note="4 HP" />
            </div>
            {sheet.hpMarked >= currentHpMax && <p className="sheet-alert is-rose">Last HP marked — resolve a Death Move (Blaze of Glory, Avoid Death, or Risk It All).</p>}
            {sheet.stressMarked >= currentStressMax && <p className="sheet-alert is-violet">Last Stress marked — you are Vulnerable until you clear 1 Stress.</p>}
          </section>

          <div className="folio-recovery-actions"><button type="button" onClick={() => openRecovery('damage')}><Icon name="shield" />Take damage<Icon name="arrow" /></button><button type="button" onClick={() => openRecovery('rest')}><Icon name="moon" />Take a rest<Icon name="arrow" /></button></div>
          <section className="sheet-panel folio-play-guide"><PanelHead title="Your next move" icon="dice" /><ul className="sheet-session-hints"><li><Icon name="dice" /><span>Roll a trait to act.</span></li><li><Icon name="spark" /><span>Spend Hope to add an Experience.</span></li><li><Icon name="shield" /><span>Use Armor to reduce damage.</span></li></ul><button type="button" className="sheet-ghost" onClick={() => setTab('features')}><Icon name="book" />Class & heritage features</button></section>
          </div>

          <div className="sheet-col">
          <section className="sheet-panel">
            <PanelHead icon="combat" title="Active weapons" note={`Proficiency ${sheet.proficiency}`} />
            <div className="sheet-prof">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className={`sheet-prof-pip ${index < sheet.proficiency ? 'is-on' : ''}`} />)}
            </div>
            <div className="sheet-weapons">
              {primary ? <WeaponCard weapon={primary} slot="Primary" modifier={weaponModifier(sheet, primary)} damage={damageNotation(primary.damage, sheet.proficiency)} disabled={rolling} onAttack={() => attack(primary)} onChange={()=>setEquipmentSlot('primary')} onUnequip={()=>mutate(current=>equipEquipment(current,'primary',null))} /> : <EmptyEquipment slot="primary" onEquip={()=>setEquipmentSlot('primary')} />}
              {secondary ? <WeaponCard weapon={secondary} slot="Secondary" modifier={weaponModifier(sheet, secondary)} damage={damageNotation(secondary.damage, sheet.proficiency)} disabled={rolling} onAttack={() => attack(secondary)} onChange={()=>setEquipmentSlot('secondary')} onUnequip={()=>mutate(current=>equipEquipment(current,'secondary',null))} /> : <EmptyEquipment slot="secondary" disabled={secondaryBlocked(sheet)} onEquip={()=>setEquipmentSlot('secondary')} />}
            </div>
            {spellcastOptions.length > 0 && (
              <div className="sheet-inline">
                <span className="sheet-mini-label">Spellcast</span>
                {spellcastOptions.map((trait) => (
                  <button key={trait} type="button" onClick={() => mutate((current) => ({ ...current, spellcastTraitOverride: trait }))} className={`sheet-chip ${spellcastTrait === trait ? 'is-active' : ''}`}>
                    {TRAIT_LABELS[trait]} (+{sheet.traits[trait]})
                  </button>
                ))}
              </div>
            )}
          </section>


          </div>

          <div className="sheet-col">
          <section className="sheet-panel">
            <PanelHead icon="spark" title="Experiences" />
            <ul className="sheet-experiences">
              {sheet.experiences.map((experience) => (
                <li key={experience.id}><Icon name="spark" /><span>{experience.name}</span><span className="sheet-mod">+{experience.modifier}</span></li>
              ))}
              {sheet.experiences.length === 0 && <li className="sheet-empty">No Experiences yet.</li>}
            </ul>
          </section>

          <section className="sheet-panel folio-loadout"><PanelHead icon="spark" title="Active abilities" note={`${loadout.length} / ${MAX_LOADOUT} CARDS`} /><input className="sheet-input folio-ability-search" aria-label="Find an active ability" placeholder="Find an ability…" value={abilitySearch} onChange={event => setAbilitySearch(event.target.value)} /><div className="folio-ability-list">{loadout.filter(card => `${card.name} ${card.text}`.toLowerCase().includes(abilitySearch.toLowerCase())).map(card => <AbilityCard compact key={card.id} name={card.name} text={card.text} domain={card.domain} category={`${DOMAIN_LABELS[card.domain] ?? card.domain} · Level ${card.level} · ${card.type}`} />)}{loadout.length === 0 && <p className="sheet-empty">Recall a domain card from your vault to use it here.</p>}{loadout.length > 0 && !loadout.some(card => `${card.name} ${card.text}`.toLowerCase().includes(abilitySearch.toLowerCase())) && <p className="sheet-empty">No active abilities match.</p>}</div><button className="folio-text-link" type="button" onClick={() => setTab('features')}>Manage cards & vault<Icon name="arrow" /></button></section>
          <section className="sheet-panel">
            <PanelHead icon="dice" title="Recent rolls" note={`${messages.length} logged`} />
            <ol className="sheet-results">
              {messages.length === 0 && <li className="sheet-empty">No actions recorded on this sheet yet.</li>}
              {messages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
            </ol>
          </section>
          </div>
        </div>
      )}

      {tab === 'features' && (
        <div className="sheet-features">
          <section className="sheet-panel sheet-effects-panel">
            <PanelHead icon="spark" title="Domain abilities" note={`${loadout.length}/${MAX_LOADOUT} active`} />
            <div className="sheet-card-grid">
              {loadout.map((card) => <DomainCardView key={card.id} id={card.id} name={card.name} domain={card.domain} level={card.level} type={card.type} recallCost={card.recallCost} text={card.text} action={{ label: 'Stash in vault', onClick: () => stashCard(card.id) }} />)}
              {loadout.length === 0 && <p className="sheet-empty">No active effects. Open the vault to recall a card.</p>}
            </div>
            <details className="sheet-vault">
              <summary>Vault <span>{vault.length}</span></summary>
              <div className="sheet-inline sheet-vault-filters">
                <button type="button" onClick={() => setVaultDomain('all')} className={`sheet-chip ${vaultDomain === 'all' ? 'is-active' : ''}`}>All</button>
                {vaultDomains.map((domain) => <button key={domain} type="button" onClick={() => setVaultDomain(domain)} className={`sheet-chip ${vaultDomain === domain ? 'is-active' : ''}`}>{DOMAIN_LABELS[domain] ?? domain}</button>)}
              </div>
              <div className="sheet-card-grid">
                {vaultFiltered.map((card) => <DomainCardView key={card.id} id={card.id} name={card.name} domain={card.domain} level={card.level} type={card.type} recallCost={card.recallCost} text={card.text} action={{ label: `Recall · ${card.recallCost} Stress`, onClick: () => recallCard(card.id) }} />)}
                {vaultFiltered.length === 0 && <p className="sheet-empty">No effects in the vault.</p>}
              </div>
            </details>
          </section>
            <section className="sheet-panel">
              <PanelHead icon="book" title="Class features" note={cls?.name ?? '—'} />
              <FeatureList features={[...(cls?.hopeFeature ? [{ name: `Hope: ${cls.hopeFeature.name}`, text: cls.hopeFeature.text }] : []), ...(cls?.classFeatures ?? [])]} />
              
            </section>

            {subclass && (
              <section className="sheet-panel">
                <PanelHead icon="compass" title="Subclass" note={`${subclass.name} · ${sheet.subclassUpgraded === 0 ? 'Foundation' : sheet.subclassUpgraded === 1 ? 'Specialization' : 'Mastery'}`} />
                <div className="sheet-feature-col">
                  {([{ id: 'foundation', label: 'Foundation', features: subclass.foundation }, ...(sheet.subclassUpgraded >= 1 ? [{ id: 'specialization', label: 'Specialization', features: subclass.specialization }] : []), ...(sheet.subclassUpgraded >= 2 ? [{ id: 'mastery', label: 'Mastery', features: subclass.mastery }] : [])] as const).map((part) => (
                    <div key={part.id}><p className="sheet-mini-label">{part.label}</p><FeatureList features={part.features} label={`${part.label} feature`} /></div>
                  ))}
                </div>
                <p className="sheet-note mt-2">Spellcast trait: {subclass.spellcastTrait ?? 'none'}{sheet.multiclassId ? ' · Mastery locked after multiclassing' : ''}</p>
              </section>
            )}

            <section className="sheet-panel">
              <div className="sheet-card-head">
                <PanelHead icon="users" title="Heritage" note={heritageDisplayName(sheet)} />
                <button type="button" onClick={() => setEditingHeritage((value) => !value)} className="sheet-ghost is-small">{editingHeritage ? 'Done' : 'Edit'}</button>
              </div>
              {editingHeritage ? (
                <HeritageEditor sheet={sheet} onSave={(patch) => { mutate((current) => ({ ...current, ...patch })); setEditingHeritage(false); }} />
              ) : (
                <div className="sheet-feature-col">
                  {ancestry && <div><p className="sheet-mini-label">{mixedAncestry ? `${ancestry.name} / ${mixedAncestry.name}` : ancestry.name}</p><FeatureList features={mixedAncestry ? heritage.map((feature) => ({ name: `${feature.name} · ${feature.ancestryName}`, text: feature.text })) : ancestry.features} label="Ancestry feature" /></div>}
                  {community && <div><p className="sheet-mini-label">{community.name}</p><FeatureList features={community.features} label="Community feature" /><details className="sheet-context"><summary>About the community</summary><p>{community.description}</p></details></div>}
                </div>
              )}
              {!mixedAncestry && bonuses.notes.length > 0 && <p className="sheet-note mt-2">{bonuses.notes.join(' · ')}</p>}
            </section>

            {multiclass && (
              <section className="sheet-panel is-sky">
                <PanelHead title={`Multiclass · ${multiclass.name}`} note={multiclassDomainId ? `${DOMAIN_LABELS[multiclassDomainId] ?? multiclassDomainId} · cards ≤ level ${multiclassCardCap(sheet)}` : 'All class domains'} />
                <FeatureList features={[...(multiclass.hopeFeature ? [{ name: `Hope: ${multiclass.hopeFeature.name}`, text: multiclass.hopeFeature.text }] : []), ...(multiclass.classFeatures ?? [])]} />
                {spellcastOptions.length > 1 && (
                  <div className="sheet-inline mt-2">
                    <span className="sheet-mini-label">Spellcast</span>
                    {spellcastOptions.map((trait) => <button key={trait} type="button" onClick={() => mutate((current) => ({ ...current, spellcastTraitOverride: trait }))} className={`sheet-chip ${spellcastTrait === trait ? 'is-active' : ''}`}>{TRAIT_LABELS[trait]} (+{sheet.traits[trait]})</button>)}
                  </div>
                )}
                {multiclassSubclass && <div className="mt-3"><p className="sheet-mini-label">{multiclassSubclass.name} · Foundation</p><FeatureList features={multiclassSubclass.foundation} label="Foundation feature" /><details className="sheet-context"><summary>About the subclass</summary><p>{multiclassSubclass.description}</p></details></div>}
                <p className="sheet-note mt-2">Domain cards from the new domain are limited to half your level (rounded up, currently {multiclassCardCap(sheet)}). Attacks and spells use your current level. Mastery is locked after multiclassing.</p>
              </section>
            )}
            {!multiclass && sheet.level >= 5 && <p className="sheet-callout">Multiclassing unlocks at level 5 (Tier 3) via Level Up. It uses both level-up slots, grants one new domain, the class feature, and a foundation subclass card.</p>}
        </div>
      )}

      {(tab === 'details' || tab === 'equipment') && (
        <div className="sheet-details">
          {tab === 'equipment' && <section className="sheet-panel">
            <PanelHead icon="backpack" title="Equipment" note={`${sheet.inventory.filter(entry=>entry.qty>0).length} items`} />
            <div className="sheet-equip">
              <div className="sheet-equip-col">
                <p className="sheet-mini-label">Weapons</p>
                {primary ? <WeaponCard weapon={primary} slot="Primary" modifier={weaponModifier(sheet, primary)} damage={damageNotation(primary.damage, sheet.proficiency)} disabled={rolling} onAttack={() => attack(primary)} onChange={()=>setEquipmentSlot('primary')} onUnequip={()=>mutate(current=>equipEquipment(current,'primary',null))} /> : <EmptyEquipment slot="primary" onEquip={()=>setEquipmentSlot('primary')} />}
                {secondary ? <WeaponCard weapon={secondary} slot="Secondary" modifier={weaponModifier(sheet, secondary)} damage={damageNotation(secondary.damage, sheet.proficiency)} disabled={rolling} onAttack={() => attack(secondary)} onChange={()=>setEquipmentSlot('secondary')} onUnequip={()=>mutate(current=>equipEquipment(current,'secondary',null))} /> : <EmptyEquipment slot="secondary" disabled={secondaryBlocked(sheet)} onEquip={()=>setEquipmentSlot('secondary')} />}
                <p className="sheet-mini-label mt-3">Armor</p>
                <ArmorCard armor={equippedArmor} score={currentArmorScore} thresholds={thresholds} onChange={()=>setEquipmentSlot('armor')} onUnequip={()=>mutate(current=>equipEquipment(current,'armor',null))} />
              </div>
              <div className="sheet-equip-col">
                <div className="sheet-card-head">
                  <p className="sheet-mini-label"><Icon name="backpack" />Inventory</p>
                  <div className="inventory-heading-actions"><label className="sheet-gold"><Icon name="coins" />Gold <input type="number" min={0} value={sheet.gold} onChange={(event) => mutate((current) => ({ ...current, gold: Math.max(0, Number.parseInt(event.target.value, 10) || 0) }))} /></label><button type="button" className="sheet-primary" onClick={()=>openInventoryAdder()}><Icon name="plus" />Add items</button></div>
                </div>
                <div className="sheet-inventory-tools"><label className="equipment-search"><Icon name="search" /><input aria-label="Search inventory" placeholder="Find in inventory…" value={inventoryQuery} onChange={event=>setInventoryQuery(event.target.value)} /></label><select aria-label="Inventory category" value={inventoryFilter} onChange={event=>setInventoryFilter(event.target.value as InventoryKind|'all')}><option value="all">All items</option>{Object.entries(INVENTORY_KIND_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
                {inventoryMessage&&<p className="inventory-added-message" role="status"><Icon name="check" />{inventoryMessage}</p>}
                <ul className="sheet-inventory">
                  {filteredInventory.map((entry) => (
                    <li key={entry.id}>
                      <ItemGlyph item={entry} className="sheet-item-emblem" /><span className="sheet-inv-name">{entry.name}<small className="sheet-item-kind">{INVENTORY_KIND_LABELS[entry.kind]}</small>{entry.kind==='armor'&&entry.equipmentId&&(entry.armorSlotsMarked??0)>0&&<small className="sheet-stowed-armor">{entry.armorSlotsMarked} Armor Slots used</small>}{inventoryEquipmentSlot(entry)&&<button type="button" className="sheet-ghost sheet-inventory-equip" aria-label={`Equip ${entry.name}`} disabled={entry.qty<=0||(inventoryEquipmentSlot(entry)==='secondary'&&secondaryBlocked(sheet))} title={inventoryEquipmentSlot(entry)==='secondary'&&secondaryBlocked(sheet)?'Requires a one-handed primary weapon':undefined} onClick={()=>mutate(current=>equipEquipment(current,inventoryEquipmentSlot(entry)!,inventoryEquipmentId(entry)!,entry.id))}>Equip</button>}{entry.description && <details className="sheet-item-description"><summary>Details</summary><p>{entry.description}</p></details>}</span>
                      <span className="sheet-qty">
                        <button type="button" onClick={() => changeQty(entry.id, -1)} aria-label={`Decrease ${entry.name}`}><Icon name="minus" /></button>
                        <span>{entry.qty}</span>
                        <button type="button" onClick={() => changeQty(entry.id, 1)} aria-label={`Increase ${entry.name}`}><Icon name="plus" /></button>
                      </span>
                      <button type="button" onClick={() => removeItem(entry.id)} className="sheet-remove" aria-label={`Remove ${entry.name}`}><Icon name="trash" /></button>
                    </li>
                  ))}
                  {filteredInventory.length === 0 && <li className="sheet-empty">{sheet.inventory.some(entry=>entry.qty>0)?'No items match your search.':'No carried items yet. Use Add items to fill your inventory.'}</li>}
                </ul>
              </div>
            </div>
          </section>}

          {tab === 'details' && <><section className="sheet-panel">
            <PanelHead icon="book" title="Background & connections" />
            <div className="sheet-two-col">
              <BackgroundList title="Background questions" entries={sheet.background} onChange={(index, answer) => mutate((current) => ({ ...current, background: current.background.map((entry, position) => position === index ? { ...entry, answer } : entry) }))} />
              <BackgroundList title="Connections" entries={sheet.connections} onChange={(index, answer) => mutate((current) => ({ ...current, connections: current.connections.map((entry, position) => position === index ? { ...entry, answer } : entry) }))} />
            </div>
          </section>

          <section className="sheet-panel">
            <PanelHead icon="spark" title="Progression" note={`Level ${sheet.level} · ${tierLabel(sheet.level)}`} />
            <dl className="sheet-session-facts"><div><dt>Proficiency</dt><dd>{sheet.proficiency}</dd></div><div><dt>Subclass</dt><dd>{sheet.subclassUpgraded === 0 ? 'Foundation' : sheet.subclassUpgraded === 1 ? 'Specialization' : 'Mastery'}</dd></div></dl>{sheet.traitMarks.length > 0 && <p className="sheet-note">Trait marks: {sheet.traitMarks.map(trait => TRAIT_LABELS[trait]).join(', ')}</p>}
            {(sheet.advancementHistory ?? []).length > 0 ? (
              <ul className="sheet-history">
                {(sheet.advancementHistory ?? []).map((entry, index) => <li key={`${entry.level}-${entry.advancement}-${index}`}><span>Level {entry.level}</span>{entry.advancement}</li>)}
              </ul>
            ) : <p className="sheet-note mt-2">No level-up history recorded yet.</p>}
          </section>

          <section className="sheet-panel">
            <PanelHead icon="note" title="Session notes" />
            <textarea aria-label="Session notes" rows={5} value={sheet.notes} onChange={(event) => mutate((current) => ({ ...current, notes: event.target.value }))} placeholder="Table notes, plans, reminders…" className="sheet-textarea" />
          </section></>}
        </div>
      )}

      </div>
      {equipmentSlot && <EquipmentPicker key={equipmentSlot} slot={equipmentSlot} sheet={sheet} onAddItems={query=>openInventoryAdder(equipmentSlot,query)} onClose={()=>setEquipmentSlot(null)} onEquip={entryId=>{ mutate(current=>{const entry=current.inventory.find(item=>item.id===entryId);const id=entry&&inventoryEquipmentId(entry);if(!entry||!id)throw new Error('This item is no longer in your inventory.');return equipEquipment(current,equipmentSlot,id,entry.id);}); setEquipmentSlot(null); }} />}
      {inventoryAddOpen && <EquipmentPicker key="inventory-add" sheet={sheet} initialKind={inventoryAddKind} initialQuery={inventoryAddQuery} onClose={closeInventoryAdder} onAdd={addition=>{mutate(current=>addInventoryItem(current,addition));setInventoryQuery('');setInventoryFilter('all');setInventoryMessage(`Added ${addition.qty} × ${addition.kind==='custom'?addition.name.trim():catalogInventoryItem(addition.kind,addition.catalogId)?.name??'item'}.`);closeInventoryAdder();}} />}
      <Dialog open={recovery !== null} onClose={() => setRecovery(null)} title={recovery === 'damage' ? 'Take damage' : 'Rest & recover'} className="folio-recovery-dialog"><div className="sheet-page folio-dialog-content">{recovery === 'damage' ? (
<div className="sheet-stack">
              <div className="sheet-inline-nowrap"><input type="number" aria-label="Incoming damage" min={0} value={incoming} onChange={(event) => setIncoming(event.target.value)} placeholder="Damage" className="sheet-input" /><button type="button" onClick={applyDamage} className="sheet-apply">Apply</button></div>
              <label className="sheet-check"><input type="checkbox" checked={useArmorSlot} disabled={directDamage || !armorSlotAvailable} onChange={(event) => setUseArmorSlot(event.target.checked)} /> Mark 1 Armor Slot ({armorSlotAvailable ? 'reduces one step' : 'no slots'})</label>
              <label className="sheet-check"><input type="checkbox" checked={directDamage} onChange={(event) => setDirectDamage(event.target.checked)} /> Direct damage (ignores armor)</label>
              <p className="sheet-note">Below Major = 1 HP, Major = 2 HP, Severe = 3 HP (Massive = 4 HP).</p>
            </div>) : (
<div className="sheet-stack">
              <label className="sheet-check"><input type="checkbox" checked={withAllies} onChange={(event) => setWithAllies(event.target.checked)} /> Prepared with allies (+2 Hope instead of +1)</label>
              <div><p className="sheet-mini-label">Short</p><div className="sheet-rest-grid"><RestButton onClick={() => shortRest('hp')}>Tend Wounds</RestButton><RestButton onClick={() => shortRest('stress')}>Clear Stress</RestButton><RestButton onClick={() => shortRest('armor')}>Repair Armor</RestButton><RestButton onClick={() => prepareRest(withAllies ? 2 : 1, 'short')}>Prepare</RestButton></div><p className="sheet-note mt-1">GM gains 1d4 Fear.</p></div>
              <div><p className="sheet-mini-label">Long</p><div className="sheet-rest-grid"><RestButton onClick={() => { mutate((current) => ({ ...current, hpMarked: 0 })); pushMessage('Long rest — all Hit Points cleared.'); }}>Heal all HP</RestButton><RestButton onClick={() => { mutate((current) => ({ ...current, stressMarked: 0 })); pushMessage('Long rest — all Stress cleared.'); }}>Clear all Stress</RestButton><RestButton onClick={() => { mutate((current) => ({ ...current, armorSlotsMarked: 0 })); pushMessage('Long rest — all armor slots repaired.'); }}>Repair Armor</RestButton><RestButton onClick={() => prepareRest(withAllies ? 2 : 1, 'long')}>Prepare</RestButton></div><p className="sheet-note mt-1">GM gains 1d4 + number of PCs Fear.</p></div>
            </div>)}{recoveryResult && <p className="folio-recovery-result" role="status">{recoveryResult}</p>}</div></Dialog>
      <ExportPdfDialog sheet={sheet} open={exportOpen} onClose={() => setExportOpen(false)} />
      <CharacterImagesDialog sheet={sheet} open={imagesOpen} onClose={() => setImagesOpen(false)} connected={connection === 'open'} onChange={patch => {
        if (connectionRef.current !== 'open') throw new Error('Reconnect to the campaign before saving this image.');
        mutate(current => ({ ...current, ...patch }));
      }} />
      <Dialog open={actionsOpen} onClose={() => setActionsOpen(false)} title="Character actions" className="folio-actions-dialog"><p className="daggery-dialog-description">Manage {sheet.name}’s character sheet.</p><button type="button" className="sheet-ghost mt-5" onClick={() => { setActionsOpen(false); setImagesOpen(true); }}><Icon name="image" />Character images</button><button type="button" className="sheet-ghost mt-5" onClick={() => { setActionsOpen(false); setExportOpen(true); }}><Icon name="pdf" />Export editable PDF</button><button type="button" className="sheet-primary mt-5" disabled={sheet.level >= 10} onClick={() => { setActionsOpen(false); setShowLevelUp(true); }}><Icon name="spark" />Level up</button><button type="button" className="sheet-danger mt-5" onClick={() => { if (window.confirm(`Delete ${sheet.name}'s sheet?`)) onDelete(); }}><Icon name="trash" />Delete character</button></Dialog>
      {showLevelUp && <LevelUpDialog sheet={sheet} onChange={(next) => { sheetRef.current = next; onChange(next); }} onClose={() => setShowLevelUp(false)} />}
    </div>
  );
}

const TRAIT_ACTIONS: Record<TraitName, string[]> = {
  agility: ['Sprint', 'Leap', 'Maneuver'],
  strength: ['Lift', 'Smash', 'Grapple'],
  finesse: ['Control', 'Hide', 'Tinker'],
  instinct: ['Perceive', 'Sense', 'Navigate'],
  presence: ['Charm', 'Perform', 'Deceive'],
  knowledge: ['Recall', 'Analyze', 'Comprehend'],
};

function armorHint(equipped: ArmorStats | undefined): string {
  if (!equipped) return 'No armor: Major = level, Severe = 2× level';
  return `${equipped.name}: ${equipped.baseThresholds.major}/${equipped.baseThresholds.severe} base + level`;
}

function Badge({ label, tone }: { label: string; tone: 'slate' | 'accent' | 'sky' }) {
  return <span className={`sheet-badge is-${tone}`}>{label}</span>;
}

function Shield({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="sheet-shield" title={hint}>
      <span className="sheet-shield-value">{value}</span>
      <span className="sheet-shield-label">{label}</span>
    </div>
  );
}

function Threshold({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="sheet-threshold">
      <span className="sheet-threshold-label">{label}</span>
      <span className="sheet-threshold-value">{value}</span>
      <span className="sheet-threshold-note">{note}</span>
    </div>
  );
}

function PanelHead({ title, note, icon }: { title: string; note?: string; icon?: IconName }) {
  return (
    <div className="sheet-panel-head">
      <h3 className="sheet-section-title">{icon && <Icon name={icon} />}{title}</h3>
      {note && <span className="sheet-panel-note">{note}</span>}
    </div>
  );
}

function WeaponCard({ weapon, slot, modifier, damage, disabled, onAttack, onChange, onUnequip }: { weapon: WeaponStats; slot: string; modifier: number; damage: string; disabled: boolean; onAttack: () => void; onChange:()=>void; onUnequip:()=>void }) {
  return <article className="sheet-weapon session-gear-card">
    <header className="session-gear-heading"><ItemGlyph item={{kind:'weapon',name:weapon.name}} /><div><small>{slot} weapon · Tier {weapon.tier}</small><h4>{weapon.name}</h4></div><button type="button" className="sheet-ghost session-gear-change" aria-label={`Change ${slot.toLowerCase()} weapon`} onClick={onChange}><Icon name="swap" />Change</button></header>
    <div className="session-gear-management"><span>{weapon.burden}</span><button type="button" onClick={onUnequip} aria-label={`Unequip ${slot.toLowerCase()} weapon`}>Unequip</button></div>
    <div className="session-gear-value"><strong>{damage}</strong><span>{weapon.damageType === 'phy' ? 'Physical' : 'Magic'} damage</span></div>
    <dl className="sheet-session-facts"><div><dt>Attack trait</dt><dd>{weapon.trait} {modifier >= 0 ? '+' : ''}{modifier}</dd></div><div><dt>Range</dt><dd>{weapon.range}</dd></div></dl>
    {weapon.feature && <AbilityCard compact name={weapon.feature.name} text={weapon.feature.text} category="Weapon feature" />}
    <button type="button" disabled={disabled} onClick={onAttack} className="sheet-attack"><Icon name="dice" />Attack · {damage}</button>
  </article>;
}

function ArmorCard({ armor, score, thresholds, onChange, onUnequip }: { armor: ArmorStats | undefined; score: number; thresholds: { major: number; severe: number }; onChange:()=>void; onUnequip:()=>void }) {
  return <article className="sheet-armor-card session-gear-card"><header className="session-gear-heading"><ItemGlyph item={{kind:'armor',name:armor?.name??'Armor'}} /><div><small>{armor ? 'Equipped armor' : 'No armor equipped'}</small><h4>{armor?.name ?? 'Unarmored'}</h4></div><button type="button" className="sheet-ghost session-gear-change" aria-label={armor?'Change armor':'Equip armor'} onClick={onChange}><Icon name="swap" />{armor?'Change':'Equip'}</button></header>
    {armor && <div className="session-gear-management"><span>Tier {armor.tier}</span><button type="button" onClick={onUnequip} aria-label="Unequip armor">Unequip</button></div>}
    <div className="session-gear-value"><strong>{score}</strong><span>Armor Score</span></div>
    <dl className="sheet-session-facts"><div><dt>Major threshold</dt><dd>{thresholds.major}</dd></div><div><dt>Severe threshold</dt><dd>{thresholds.severe}</dd></div></dl>
    {armor?.feature && <AbilityCard compact name={armor.feature.name} text={armor.feature.text} category="Armor feature" />}
  </article>;
}

function EmptyEquipment({slot,disabled=false,onEquip}:{slot:'primary'|'secondary';disabled?:boolean;onEquip:()=>void}) {
  return <article className="session-gear-card sheet-empty-gear"><header className="session-gear-heading"><span><Icon name="combat" /></span><div><small>{slot==='primary'?'Primary':'Secondary'} weapon</small><h4>Nothing equipped</h4></div></header>{disabled&&<p className="sheet-note">Requires a one-handed primary weapon.</p>}<button type="button" className="sheet-ghost" disabled={disabled} onClick={onEquip}><Icon name="plus" />Equip {slot} weapon</button></article>;
}

function DomainCardView({ name, domain, level, type, recallCost, text, action }: { id: string; name: string; domain: string; level: number; type: string; recallCost: number; text: string; action: { label: string; onClick: () => void } }) {
  return <AbilityCard name={name} text={text} domain={domain} category={`${DOMAIN_LABELS[domain] ?? domain} · ${type} · Level ${level}`}
    footer={<><span title="Stress cost to recall this card from the vault"><Icon name="undo" />Recall {recallCost} Stress</span><button type="button" onClick={action.onClick} className="sheet-ghost">{action.label}</button></>} />;
}

function FeatureList({ features, label = 'Class feature' }: { features: { name: string; text: string }[]; label?: string }) {
  return <ul className="sheet-feature-list ability-list">{features.length === 0 && <li className="sheet-empty">No features.</li>}
    {features.map(feature => <li key={`${feature.name}-${feature.text.slice(0, 16)}`}><AbilityCard name={feature.name} text={feature.text} category={label} /></li>)}
  </ul>;
}

function RestButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="sheet-rest">{children}</button>;
}

function BackgroundList({ title, entries, onChange }: { title: string; entries: { question: string; answer: string }[]; onChange: (index: number, answer: string) => void }) {
  return (
    <div>
      <p className="sheet-mini-label">{title}</p>
      <ul className="sheet-questions">
        {entries.length === 0 && <li className="sheet-empty">Nothing recorded.</li>}
        {entries.map((entry, index) => (
          <li key={entry.question}>
            <label><span className="sheet-question-label">{entry.question}</span>
            <textarea aria-label={entry.question} rows={3} value={entry.answer} onChange={(event) => onChange(index, event.target.value)} placeholder="Write your answer…" /></label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeritageEditor({ sheet, onSave }: { sheet: Sheet; onSave: (patch: Partial<Sheet>) => void }) {
  const [heritageName, setHeritageName] = useState(sheet.heritageName ?? '');
  const [ancestryId, setAncestryId] = useState<string | null>(sheet.ancestryId);
  const [mixedAncestryId, setMixedAncestryId] = useState<string | null>(sheet.mixedAncestryId ?? null);
  const [order, setOrder] = useState<'primary-first' | 'mixed-first'>(sheet.ancestryFeatureOrder ?? 'primary-first');
  return (
    <div className="sheet-callout">
      <p className="sheet-note">Core Rulebook p. 71: name your heritage, choose two lineages, then take the first feature of one and the second feature of the other. Extra lineages are flavor only.</p>
      <div className="sheet-field-row mt-2">
        <label className="sheet-field">Heritage name<input value={heritageName} onChange={(event) => setHeritageName(event.target.value)} placeholder="e.g. Goblin-Orc" /></label>
        <label className="sheet-field">Main ancestry<select value={ancestryId ?? ''} onChange={(event) => { const v = event.target.value || null; setAncestryId(v); if (mixedAncestryId === v) setMixedAncestryId(null); }}><option value="">— none —</option>{ancestries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="sheet-field">Second ancestry<select value={mixedAncestryId ?? ''} onChange={(event) => setMixedAncestryId(event.target.value || null)}><option value="">— none (single) —</option>{ancestries.filter((entry) => entry.id !== ancestryId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      </div>
      {mixedAncestryId && (
        <div className="sheet-inline mt-2">
          <label className="sheet-check"><input type="radio" name="heritage-order" checked={order === 'primary-first'} onChange={() => setOrder('primary-first')} /> First from main, second from other</label>
          <label className="sheet-check"><input type="radio" name="heritage-order" checked={order === 'mixed-first'} onChange={() => setOrder('mixed-first')} /> First from other, second from main</label>
        </div>
      )}
      <div className="sheet-inline mt-3">
        <button type="button" onClick={() => onSave({ heritageName: heritageName.trim() || null, ancestryId, mixedAncestryId: mixedAncestryId ?? null, ancestryFeatureOrder: order })} className="sheet-primary">Save heritage</button>
      </div>
    </div>
  );
}
