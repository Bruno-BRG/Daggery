import {
  adversaries,
  ancestries,
  armor,
  cardUrl,
  cardsIndex,
  classes,
  communities,
  conditions,
  consumables,
  domainCards,
  domains,
  environments,
  items,
  ranges,
  transformations,
  weapons,
} from '@daggery/content';

/* ------------------------------------------------------------------ */
/* Source shapes (the JSON is generated; these mirror its fields).      */
/* ------------------------------------------------------------------ */

export interface Feature {
  name: string;
  text: string;
  kind?: string;
}

/** Optional provenance carried by the combined content catalog. */
interface Sourced {
  source?: string;
}

export interface SubclassData {
  id: string;
  name: string;
  description: string;
  spellcastTrait: string;
  foundation: Feature[];
  specialization: Feature[];
  mastery: Feature[];
}

export interface ClassData extends Sourced {
  id: string;
  name: string;
  description: string;
  domains: string[];
  startingEvasion: number;
  startingHP: number;
  classItems: string;
  hopeFeature: Feature;
  classFeatures: Feature[];
  subclasses: SubclassData[];
  backgroundQuestions: string[];
  connections: string[];
}

export interface DomainCardData extends Sourced {
  id: string;
  name: string;
  domain: string;
  level: number;
  type: string;
  recallCost: number;
  text: string;
}

export interface AncestryData extends Sourced {
  id: string;
  name: string;
  description: string;
  features: Feature[];
}

export interface CommunityData extends Sourced {
  id: string;
  name: string;
  description: string;
  features: Feature[];
}

export interface TransformationData extends Sourced {
  id: string;
  name: string;
  description: string;
  features: Feature[];
  questions: string[];
}

export interface WeaponData extends Sourced {
  id: string;
  name: string;
  category: string;
  tier: number;
  trait: string;
  range: string;
  damage: string;
  damageType: string;
  burden: string;
  feature: Feature | null;
}

export interface ArmorData extends Sourced {
  id: string;
  name: string;
  tier: number;
  baseThresholds: { major: number; severe: number };
  baseScore: number;
  feature: Feature | null;
}

export interface ItemData extends Sourced {
  id: string;
  name: string;
  description: string;
  feature: Feature | null;
}

export interface ConsumableData extends Sourced {
  id: string;
  name: string;
  description: string;
  rollTable: { name: string; roll: number } | null;
}

export interface AdversaryData extends Sourced {
  id: string;
  name: string;
  tier: number;
  type: string;
  description: string;
  motives: string;
  difficulty: number;
  thresholds: { major: number; severe: number };
  hp: number;
  stress: number;
  attack: {
    modifier: number;
    name: string;
    range: string;
    damage: string;
    damageType: string;
  };
  experiences: { name: string; bonus: number }[];
  features: Feature[];
}

export interface EnvironmentData extends Sourced {
  id: string;
  name: string;
  tier: number;
  type: string;
  description: string;
  impulses: string;
  difficulty: number;
  potentialAdversaries: string;
  features: Feature[];
}

export interface ConditionData extends Sourced {
  id: string;
  name: string;
  text: string;
}

export interface RangeData extends Sourced {
  id: string;
  name: string;
  distance: string;
}

export interface DomainData extends Sourced {
  id: string;
  name: string;
  description: string;
  classes: string[];
}

const classList = classes as unknown as ClassData[];
const domainCardList = domainCards as unknown as DomainCardData[];
const ancestryList = ancestries as unknown as AncestryData[];
const communityList = communities as unknown as CommunityData[];
const transformationList = transformations as unknown as TransformationData[];
const weaponList = weapons as unknown as WeaponData[];
const armorList = armor as unknown as ArmorData[];
const itemList = items as unknown as ItemData[];
const consumableList = consumables as unknown as ConsumableData[];
const adversaryList = adversaries as unknown as AdversaryData[];
const environmentList = environments as unknown as EnvironmentData[];
const conditionList = conditions as unknown as ConditionData[];
const rangeList = ranges as unknown as RangeData[];
const domainList = domains as unknown as DomainData[];

/* ------------------------------------------------------------------ */
/* Entries and categories                                              */
/* ------------------------------------------------------------------ */

export type EntryKind =
  | 'class'
  | 'domainCard'
  | 'ancestry'
  | 'community'
  | 'transformation'
  | 'weapon'
  | 'armor'
  | 'item'
  | 'consumable'
  | 'adversary'
  | 'environment'
  | 'condition'
  | 'range';

export interface KindDataMap {
  class: ClassData;
  domainCard: DomainCardData;
  ancestry: AncestryData;
  community: CommunityData;
  transformation: TransformationData;
  weapon: WeaponData;
  armor: ArmorData;
  item: ItemData;
  consumable: ConsumableData;
  adversary: AdversaryData;
  environment: EnvironmentData;
  condition: ConditionData;
  range: RangeData;
}

interface EntryMeta {
  tier?: number;
  level?: number;
  domain?: string;
  type?: string;
}

export type Entry = {
  [K in EntryKind]: {
    kind: K;
    id: string;
    key: string;
    name: string;
    /** Pre-normalised haystack: name + every text field of the record. */
    search: string;
    tier?: number;
    level?: number;
    domain?: string;
    type?: string;
    data: KindDataMap[K];
  };
}[EntryKind];

export type CategoryId =
  | 'classes'
  | 'domainCards'
  | 'ancestries'
  | 'communities'
  | 'transformations'
  | 'weapons'
  | 'armor'
  | 'items'
  | 'consumables'
  | 'adversaries'
  | 'environments'
  | 'conditions';

export interface Category {
  id: CategoryId;
  label: string;
  kinds: EntryKind[];
}

export const CATEGORIES: Category[] = [
  { id: 'classes', label: 'Classes', kinds: ['class'] },
  { id: 'domainCards', label: 'Domains / Cards', kinds: ['domainCard'] },
  { id: 'ancestries', label: 'Ancestries', kinds: ['ancestry'] },
  { id: 'communities', label: 'Communities', kinds: ['community'] },
  { id: 'transformations', label: 'Transformations', kinds: ['transformation'] },
  { id: 'weapons', label: 'Weapons', kinds: ['weapon'] },
  { id: 'armor', label: 'Armor', kinds: ['armor'] },
  { id: 'items', label: 'Items', kinds: ['item'] },
  { id: 'consumables', label: 'Consumables', kinds: ['consumable'] },
  { id: 'adversaries', label: 'Adversaries', kinds: ['adversary'] },
  { id: 'environments', label: 'Environments', kinds: ['environment'] },
  { id: 'conditions', label: 'Conditions / Ranges', kinds: ['condition', 'range'] },
];

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  class: 'Class',
  domainCard: 'Domain Card',
  ancestry: 'Ancestry',
  community: 'Community',
  transformation: 'Transformation',
  weapon: 'Weapon',
  armor: 'Armor',
  item: 'Item',
  consumable: 'Consumable',
  adversary: 'Adversary',
  environment: 'Environment',
  condition: 'Condition',
  range: 'Range',
};

export const CATEGORY_OF_KIND: Record<EntryKind, CategoryId> = {
  class: 'classes',
  domainCard: 'domainCards',
  ancestry: 'ancestries',
  community: 'communities',
  transformation: 'transformations',
  weapon: 'weapons',
  armor: 'armor',
  item: 'items',
  consumable: 'consumables',
  adversary: 'adversaries',
  environment: 'environments',
  condition: 'conditions',
  range: 'conditions',
};

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const SKIP_TEXT_KEYS = new Set(['id', 'file', 'sourcePdf', 'bbox', 'page']);

/** Lower-case and strip accents so "Domain" also matches "domain". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function collectText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!SKIP_TEXT_KEYS.has(key)) collectText(child, out);
    }
  }
}

function makeEntry<K extends EntryKind>(
  kind: K,
  id: string,
  name: string,
  data: KindDataMap[K],
  meta: EntryMeta = {},
  extraSearch = '',
): Entry {
  const text: string[] = [];
  collectText(data, text);
  return {
    kind,
    id,
    key: `${kind}:${id}`,
    name,
    search: normalize(`${name} ${extraSearch} ${text.join(' ')}`),
    ...meta,
    data,
  } as Entry;
}

/* ------------------------------------------------------------------ */
/* Card art lookup                                                     */
/* ------------------------------------------------------------------ */

interface CardIndexEntry {
  id: string;
  name: string;
  kind: string;
  domain?: string;
  level?: number;
  file: string;
}

const cardEntries = cardsIndex as unknown as CardIndexEntry[];

const domainCardArt = new Map<string, CardIndexEntry>();
const ancestryArt = new Map<string, CardIndexEntry>();
const communityArt = new Map<string, CardIndexEntry>();
const subclassArt = new Map<string, CardIndexEntry>();
const transformationArt = new Map<string, CardIndexEntry>();
const normalizeCardName = (name: string) => normalize(name).replace(/[^a-z0-9]/g, '');

for (const card of cardEntries) {
  if (card.kind === 'domain' && card.domain) {
    domainCardArt.set(`${normalizeCardName(card.name)}|${card.domain}`, card);
  } else if (card.kind === 'ancestry') {
    ancestryArt.set(card.id, card);
  } else if (card.kind === 'community') {
    communityArt.set(card.id, card);
  } else if (card.kind === 'subclass') {
    subclassArt.set(card.id, card);
  } else if (card.kind === 'transformation') {
    transformationArt.set(card.id, card);
  }
}

/** CDN path (served by the app) for a card image. */
export function cardSrc(file: string, thumb = false): string {
  return cardUrl(file, thumb);
}

/** The card image for an entry, if one was extracted for it. */
export function cardFileForEntry(entry: Entry): string | null {
  if (entry.kind === 'class') return subclassCardFile(entry.data.subclasses[0]?.id ?? '', 'foundation');
  if (entry.kind === 'domainCard') {
    return domainCardArt.get(`${normalizeCardName(entry.name)}|${entry.data.domain}`)?.file ?? null;
  }
  if (entry.kind === 'ancestry') return ancestryArt.get(entry.id)?.file ?? null;
  if (entry.kind === 'community') return communityArt.get(entry.id)?.file ?? null;
  if (entry.kind === 'transformation') return transformationArt.get(entry.id)?.file ?? null;
  return null;
}

export type SubclassPart = 'foundation' | 'specialization' | 'mastery';

/** Card image filename for one tier of a subclass (some subclasses have no extracted art). */
export function subclassCardFile(subclassId: string, part: SubclassPart): string | null {
  return subclassArt.get(`${subclassId}-${part}`)?.file ?? null;
}

/* ------------------------------------------------------------------ */
/* Lookups and labels                                                  */
/* ------------------------------------------------------------------ */

const domainById = new Map(domainList.map((domain) => [domain.id, domain]));
const domainOrder = new Map(domainList.map((domain, index) => [domain.id, index]));
const classById = new Map(classList.map((cls) => [cls.id, cls]));

export const DOMAIN_OPTIONS = domainList
  .map((domain) => ({ value: domain.id, label: domain.name }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));

export const CLASS_OPTIONS = classList
  .map((cls) => ({ value: cls.id, label: cls.name }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));

export const LEVEL_OPTIONS = Array.from({ length: 10 }, (_, index) => ({
  value: String(index + 1),
  label: `Level ${index + 1}`,
}));

export const TIER_OPTIONS = [1, 2, 3, 4].map((tier) => ({
  value: String(tier),
  label: `Tier ${tier}`,
}));

export function domainLabel(domainId: string): string {
  return domainById.get(domainId)?.name ?? domainId;
}

export function classLabel(classId: string): string {
  return classById.get(classId)?.name ?? classId;
}

export function damageTypeLabel(type: string): string {
  switch (type) {
    case 'phy':
      return 'Physical';
    case 'mag':
      return 'Magic';
    case 'phy/mag':
      return 'Physical or Magic';
    case 'direct phy':
      return 'Direct Physical';
    case 'direct mag':
      return 'Direct Magic';
    default:
      return type;
  }
}

export const DICE_EXPRESSION = /\d*d\d+/i;

export function entrySubtitle(entry: Entry): string {
  switch (entry.kind) {
    case 'class':
      return `Domains: ${entry.data.domains.map(domainLabel).join(', ')}`;
    case 'domainCard':
      return `${domainLabel(entry.data.domain)} · Level ${entry.data.level} · ${entry.data.type}`;
    case 'ancestry':
      return 'Ancestry';
    case 'community':
      return 'Community';
    case 'transformation':
      return 'Transformation';
    case 'weapon':
      return `Tier ${entry.data.tier} · ${entry.data.category} · ${entry.data.trait} · ${entry.data.damage}`;
    case 'armor':
      return `Tier ${entry.data.tier} · Armor Score ${entry.data.baseScore}`;
    case 'item':
      return 'Item';
    case 'consumable':
      return entry.data.rollTable ? 'Consumable · Roll table' : 'Consumable';
    case 'adversary':
      return `Tier ${entry.data.tier} · ${entry.data.type} · Difficulty ${entry.data.difficulty}`;
    case 'environment':
      return `Tier ${entry.data.tier} · ${entry.data.type} · Difficulty ${entry.data.difficulty}`;
    case 'condition':
      return 'Condition';
    case 'range':
      return `Range · ${entry.data.distance}`;
  }
}

/* ------------------------------------------------------------------ */
/* All entries, sorted per category                                    */
/* ------------------------------------------------------------------ */

const allEntries: Entry[] = [
  ...classList.flatMap((item) => item.subclasses.map((subclass) =>
    makeEntry('class', `${item.id}:${subclass.id}`, `${item.name} — ${subclass.name}`, {
      ...item,
      subclasses: [subclass],
    }),
  )),
  ...domainCardList.map((item) =>
    makeEntry(
      'domainCard',
      item.id,
      item.name,
      item,
      { domain: item.domain, level: item.level, type: item.type },
      domainLabel(item.domain),
    ),
  ),
  ...ancestryList.map((item) => makeEntry('ancestry', item.id, item.name, item)),
  ...communityList.map((item) => makeEntry('community', item.id, item.name, item)),
  ...transformationList.map((item) => makeEntry('transformation', item.id, item.name, item)),
  ...weaponList.map((item) =>
    makeEntry('weapon', item.id, item.name, item, { tier: item.tier, type: item.category }),
  ),
  ...armorList.map((item) => makeEntry('armor', item.id, item.name, item, { tier: item.tier })),
  ...itemList.map((item) => makeEntry('item', item.id, item.name, item)),
  ...consumableList.map((item) => makeEntry('consumable', item.id, item.name, item)),
  ...adversaryList.map((item) =>
    makeEntry('adversary', item.id, item.name, item, { tier: item.tier, type: item.type }),
  ),
  ...environmentList.map((item) =>
    makeEntry('environment', item.id, item.name, item, { tier: item.tier, type: item.type }),
  ),
  ...conditionList.map((item) => makeEntry('condition', item.id, item.name, item)),
  ...rangeList.map((item) => makeEntry('range', item.id, item.name, item)),
];

export const ALL_ENTRIES: readonly Entry[] = allEntries;

export const ENTRY_BY_KEY: ReadonlyMap<string, Entry> = new Map(
  allEntries.map((entry) => [entry.key, entry]),
);

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, 'pt-BR');

const byDomainCard = (a: Entry, b: Entry) => {
  if (a.kind !== 'domainCard' || b.kind !== 'domainCard') return byName(a, b);
  const domainDelta = (domainOrder.get(a.data.domain) ?? 99) - (domainOrder.get(b.data.domain) ?? 99);
  if (domainDelta !== 0) return domainDelta;
  const levelDelta = a.data.level - b.data.level;
  if (levelDelta !== 0) return levelDelta;
  return byName(a, b);
};

const CONDITION_KIND_ORDER: Record<string, number> = { condition: 0, range: 1 };

const byKindThenName = (a: Entry, b: Entry) => {
  const kindDelta = (CONDITION_KIND_ORDER[a.kind] ?? 0) - (CONDITION_KIND_ORDER[b.kind] ?? 0);
  if (kindDelta !== 0) return kindDelta;
  return byName(a, b);
};

const byKind: Record<EntryKind, Entry[]> = {
  class: [],
  domainCard: [],
  ancestry: [],
  community: [],
  transformation: [],
  weapon: [],
  armor: [],
  item: [],
  consumable: [],
  adversary: [],
  environment: [],
  condition: [],
  range: [],
};
for (const entry of allEntries) byKind[entry.kind].push(entry);

export const ENTRIES_BY_CATEGORY: Record<CategoryId, Entry[]> = {
  classes: [...byKind.class].sort(byName),
  domainCards: [...byKind.domainCard].sort(byDomainCard),
  ancestries: [...byKind.ancestry].sort(byName),
  communities: [...byKind.community].sort(byName),
  transformations: [...byKind.transformation].sort(byName),
  weapons: [...byKind.weapon].sort(byName),
  armor: [...byKind.armor].sort(byName),
  items: [...byKind.item].sort(byName),
  consumables: [...byKind.consumable].sort(byName),
  adversaries: [...byKind.adversary].sort(byName),
  environments: [...byKind.environment].sort(byName),
  conditions: [...byKind.condition, ...byKind.range].sort(byKindThenName),
};

export function entriesForCategory(category: CategoryId): Entry[] {
  return ENTRIES_BY_CATEGORY[category];
}

export function categoryForKind(kind: EntryKind): CategoryId {
  return CATEGORY_OF_KIND[kind];
}

export function categoryLabel(category: CategoryId): string {
  return CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function firstEntryForCategory(category: CategoryId): Entry | null {
  return ENTRIES_BY_CATEGORY[category][0] ?? null;
}

export interface DomainCardGroup {
  title: string;
  entries: Entry[];
}

/** Domain cards grouped by domain; entries stay ordered by level then name. */
export function groupDomainCards(entries: Entry[]): DomainCardGroup[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.kind !== 'domainCard') continue;
    const list = groups.get(entry.data.domain);
    if (list) list.push(entry);
    else groups.set(entry.data.domain, [entry]);
  }
  return [...groups.entries()]
    .sort((a, b) => (domainOrder.get(a[0]) ?? 99) - (domainOrder.get(b[0]) ?? 99))
    .map(([domain, list]) => ({
      title: domainLabel(domain),
      entries: [...list].sort(byDomainCard),
    }));
}

/* ------------------------------------------------------------------ */
/* Filtering                                                          */
/* ------------------------------------------------------------------ */

export interface Filters {
  domain: string;
  level: string;
  tier: string;
  type: string;
  classId: string;
}

export const EMPTY_FILTERS: Filters = {
  domain: '',
  level: '',
  tier: '',
  type: '',
  classId: '',
};

export type FilterField = keyof Filters;

export function filterFieldsFor(category: CategoryId, searching: boolean): FilterField[] {
  if (searching) return ['domain', 'level', 'tier', 'type', 'classId'];
  switch (category) {
    case 'domainCards':
      return ['domain', 'level', 'type', 'classId'];
    case 'adversaries':
    case 'environments':
      return ['tier', 'type'];
    case 'weapons':
      return ['tier', 'type'];
    case 'armor':
      return ['tier'];
    default:
      return [];
  }
}

export function typeOptionsFor(category: CategoryId, searching: boolean): { value: string; label: string }[] {
  const source = searching ? allEntries : ENTRIES_BY_CATEGORY[category];
  const values = new Set<string>();
  for (const entry of source) if (entry.type) values.add(entry.type);
  return [...values]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((value) => ({ value, label: value }));
}

function matchesFilters(entry: Entry, filters: Filters): boolean {
  if (filters.tier && entry.tier !== Number(filters.tier)) return false;
  if (filters.level && entry.level !== Number(filters.level)) return false;
  if (filters.domain && entry.domain !== filters.domain) return false;
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.classId) {
    if (entry.kind !== 'domainCard') return false;
    const cls = classById.get(filters.classId);
    if (!cls || !cls.domains.includes(entry.data.domain)) return false;
  }
  return true;
}

export function filterEntries(
  entries: Entry[],
  filters: Filters,
  query: string,
): { entries: Entry[]; matchedBeforeFilters: Entry[] } {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return { entries: entries.filter((entry) => matchesFilters(entry, filters)), matchedBeforeFilters: entries };
  }
  const matchedBeforeFilters = entries.filter((entry) => entry.search.includes(normalizedQuery));
  return {
    entries: matchedBeforeFilters.filter((entry) => matchesFilters(entry, filters)),
    matchedBeforeFilters,
  };
}

export function hasActiveFilters(filters: Filters): boolean {
  return Object.values(filters).some(Boolean);
}
