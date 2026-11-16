import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Dialog } from '../../components/Dialog';
import { Group, ItemCard, PanelSection, SearchField, TONES } from '../../components/Accordion';
import { inventoryItemIcon } from '../sheets/inventoryIcons';
import type { ZoomRequest } from './components';
import { EntryDetail } from './detail';
import {
  ALL_ENTRIES,
  CATEGORIES,
  CLASS_OPTIONS,
  DOMAIN_OPTIONS,
  EMPTY_FILTERS,
  ENTRIES_BY_CATEGORY,
  LEVEL_OPTIONS,
  TIER_OPTIONS,
  categoryForKind,
  domainLabel,
  filterEntries,
  hasActiveFilters,
  typeOptionsFor,
  type CategoryId,
  type Entry,
  type FilterField,
  type Filters,
} from './data';
import './compendium.css';

const FILTER_LABELS: Record<FilterField, string> = {
  domain: 'Domain',
  level: 'Level',
  tier: 'Tier',
  type: 'Type',
  classId: 'Class',
};
const FILTER_ORDER: FilterField[] = ['domain', 'level', 'tier', 'type', 'classId'];

const CATEGORY_ICONS: Record<CategoryId, IconName> = {
  classes: 'sheet',
  domainCards: 'magic',
  ancestries: 'ancestry',
  communities: 'users',
  transformations: 'paw',
  weapons: 'weapon',
  armor: 'armor',
  items: 'backpack',
  consumables: 'potion',
  adversaries: 'adversary',
  environments: 'tree',
  conditions: 'target',
};

const CATEGORY_TONES: Record<CategoryId, string> = {
  classes: TONES.gold,
  domainCards: TONES.violet,
  ancestries: TONES.teal,
  communities: TONES.green,
  transformations: TONES.violet,
  weapons: TONES.red,
  armor: TONES.blue,
  items: TONES.gold,
  consumables: TONES.green,
  adversaries: TONES.fear,
  environments: TONES.teal,
  conditions: TONES.pink,
};

/** Each domain keeps the same tint everywhere, in a stable order. */
const DOMAIN_TONE_PALETTE = [
  TONES.violet,
  TONES.blue,
  TONES.teal,
  TONES.green,
  TONES.pink,
  TONES.gold,
  TONES.red,
  TONES.brand,
  TONES.fear,
];
const DOMAIN_TONES = new Map(
  DOMAIN_OPTIONS.map((option, index) => [
    option.value,
    DOMAIN_TONE_PALETTE[index % DOMAIN_TONE_PALETTE.length] ?? TONES.violet,
  ]),
);
const DOMAIN_ORDER = new Map(DOMAIN_OPTIONS.map((option, index) => [option.value, index]));

interface EntryGroup {
  id: string;
  title: string;
  entries: Entry[];
  /** Only used to order tier groups. */
  order?: number;
}

interface CategorySection {
  category: CategoryId;
  label: string;
  entries: Entry[];
  groups: EntryGroup[];
}

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, 'pt-BR');

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function pickGroup(map: Map<string, EntryGroup>, id: string, title: string, entry: Entry, order?: number): void {
  const existing = map.get(id);
  if (existing) existing.entries.push(entry);
  else map.set(id, { id, title, entries: [entry], ...(order === undefined ? {} : { order }) });
}

/**
 * Natural sub-groups inside a category: classes by class, domain cards by domain, equipment and
 * adversaries by tier, loot by its printed roll table, conditions separately from ranges.
 * Categories without a useful split return no groups and are listed directly.
 */
function groupsFor(category: CategoryId, entries: Entry[]): EntryGroup[] {
  const map = new Map<string, EntryGroup>();
  switch (category) {
    case 'classes':
      for (const entry of entries) {
        if (entry.kind !== 'class') continue;
        pickGroup(map, slug(entry.data.name), entry.data.name, entry);
      }
      for (const group of map.values()) group.entries.sort(byName);
      return [...map.values()];
    case 'domainCards':
      for (const entry of entries) {
        if (entry.kind !== 'domainCard') continue;
        pickGroup(map, entry.data.domain, domainLabel(entry.data.domain), entry);
      }
      for (const group of map.values()) {
        group.entries.sort((a, b) => {
          if (a.kind !== 'domainCard' || b.kind !== 'domainCard') return byName(a, b);
          return a.data.level - b.data.level || byName(a, b);
        });
      }
      return [...map.values()].sort(
        (a, b) => (DOMAIN_ORDER.get(a.id) ?? 99) - (DOMAIN_ORDER.get(b.id) ?? 99),
      );
    case 'weapons':
    case 'armor':
    case 'adversaries':
    case 'environments':
      for (const entry of entries) {
        const tier =
          entry.kind === 'weapon' || entry.kind === 'armor' || entry.kind === 'adversary' || entry.kind === 'environment'
            ? entry.data.tier
            : 0;
        pickGroup(map, `tier-${tier}`, `Tier ${tier}`, entry, tier);
      }
      for (const group of map.values()) group.entries.sort(byName);
      return [...map.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    case 'items':
    case 'consumables': {
      const fallback = category === 'items' ? 'Other items' : 'Other consumables';
      for (const entry of entries) {
        if (entry.kind !== 'item' && entry.kind !== 'consumable') continue;
        const table = entry.data.rollTable?.name ?? fallback;
        pickGroup(map, slug(table), table, entry);
      }
      for (const group of map.values()) {
        group.entries.sort((a, b) => {
          const roll = (entry: Entry) =>
            entry.kind === 'item' || entry.kind === 'consumable' ? entry.data.rollTable?.roll ?? 99 : 99;
          return roll(a) - roll(b) || byName(a, b);
        });
      }
      return [...map.values()];
    }
    case 'conditions':
      for (const entry of entries) {
        const ranges = entry.kind === 'range';
        pickGroup(map, ranges ? 'ranges' : 'conditions', ranges ? 'Ranges' : 'Conditions', entry);
      }
      for (const group of map.values()) group.entries.sort(byName);
      return [...map.values()];
    case 'ancestries':
    case 'communities':
    case 'transformations':
      return [];
  }
}

function entryCaption(entry: Entry): string {
  switch (entry.kind) {
    case 'class':
      return `Class · ${entry.data.domains.map(domainLabel).join(', ')}`;
    case 'domainCard':
      return `Domain · ${domainLabel(entry.data.domain)} · Level ${entry.data.level}`;
    case 'ancestry':
      return 'Ancestry';
    case 'community':
      return 'Community';
    case 'transformation':
      return 'Transformation';
    case 'weapon':
      return `Weapon · Tier ${entry.data.tier} · ${entry.data.category}`;
    case 'armor':
      return `Armor · Tier ${entry.data.tier}`;
    case 'item':
      return entry.data.rollTable
        ? `Item · ${entry.data.rollTable.name} · Roll ${entry.data.rollTable.roll}`
        : 'Item';
    case 'consumable':
      return entry.data.rollTable
        ? `Consumable · ${entry.data.rollTable.name} · Roll ${entry.data.rollTable.roll}`
        : 'Consumable';
    case 'adversary':
      return `Adversary · Tier ${entry.data.tier} · ${entry.data.type}`;
    case 'environment':
      return `Environment · Tier ${entry.data.tier} · ${entry.data.type}`;
    case 'condition':
      return 'Condition';
    case 'range':
      return `Range · ${entry.data.distance}`;
  }
}

function entryIcon(entry: Entry): IconName {
  if (entry.kind === 'weapon' || entry.kind === 'armor' || entry.kind === 'item' || entry.kind === 'consumable') {
    return inventoryItemIcon({ kind: entry.kind, name: entry.name });
  }
  return CATEGORY_ICONS[categoryForKind(entry.kind)];
}

function entryTone(entry: Entry): string {
  if (entry.kind === 'domainCard') return DOMAIN_TONES.get(entry.data.domain) ?? TONES.violet;
  return CATEGORY_TONES[categoryForKind(entry.kind)];
}

function flip(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function optionsFor(field: FilterField, typeOptions: { value: string; label: string }[]) {
  switch (field) {
    case 'domain':
      return DOMAIN_OPTIONS;
    case 'level':
      return LEVEL_OPTIONS;
    case 'tier':
      return TIER_OPTIONS;
    case 'type':
      return typeOptions;
    case 'classId':
      return CLASS_OPTIONS;
  }
}

export default function CompendiumModule({ author }: { author: string }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [zoom, setZoom] = useState<ZoomRequest | null>(null);
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(() => new Set());
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const searching = !!deferredQuery.trim();
  const activeFilters = hasActiveFilters(filters);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const typeOptions = useMemo(() => typeOptionsFor('classes', true), []);

  useEffect(() => {
    setClosedSections(new Set());
    setClosedGroups(new Set());
  }, [deferredQuery]);

  const sections = useMemo<CategorySection[]>(() => {
    const result: CategorySection[] = [];
    if (deferredQuery.trim()) {
      const { entries } = filterEntries([...ALL_ENTRIES], filters, deferredQuery);
      const byCategory = new Map<CategoryId, Entry[]>();
      for (const entry of entries) {
        const id = categoryForKind(entry.kind);
        const list = byCategory.get(id);
        if (list) list.push(entry);
        else byCategory.set(id, [entry]);
      }
      for (const category of CATEGORIES) {
        const list = byCategory.get(category.id);
        if (!list?.length) continue;
        result.push({
          category: category.id,
          label: category.label,
          entries: list,
          groups: groupsFor(category.id, list),
        });
      }
      return result;
    }
    for (const category of CATEGORIES) {
      const { entries } = filterEntries(ENTRIES_BY_CATEGORY[category.id], filters, '');
      if (!entries.length) continue;
      result.push({
        category: category.id,
        label: category.label,
        entries,
        groups: groupsFor(category.id, entries),
      });
    }
    return result;
  }, [deferredQuery, filters]);

  function card(entry: Entry) {
    return (
      <ItemCard
        key={entry.key}
        title={entry.name}
        caption={entryCaption(entry)}
        icon={entryIcon(entry)}
        tone={entryTone(entry)}
      >
        <EntryDetail entry={entry} author={author} onZoom={setZoom} />
      </ItemCard>
    );
  }

  return (
    <div className="sg-page compendium-page">
      <div className="compendium-toolbar">
        <p className="sg-page-intro">
          Search every class, domain card, piece of equipment, adversary and rule in the compendium.
        </p>
        <SearchField value={query} onChange={setQuery} placeholder="Search name or key word" />
        <details className="compendium-filters">
          <summary>
            <Icon name="settings" />
            <span>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</span>
            <Icon name="chevron" />
          </summary>
          <div className="compendium-filter-grid">
            {FILTER_ORDER.map((field) => (
              <label key={field}>
                {FILTER_LABELS[field]}
                <select
                  aria-label={FILTER_LABELS[field]}
                  value={filters[field]}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, [field]: event.target.value }))
                  }
                >
                  <option value="">All</option>
                  {optionsFor(field, typeOptions).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {activeFilters && (
              <button type="button" className="compendium-clear-filters" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        </details>
      </div>

      {sections.map((section) => {
        const sectionKey = section.category;
        const groupProps = searching
          ? {
              open: !closedSections.has(sectionKey),
              onToggle: () => setClosedSections((current) => flip(current, sectionKey)),
            }
          : {};
        return (
          <PanelSection
            key={section.category}
            title={
              <>
                {section.label}
                <span className="compendium-count">{section.entries.length}</span>
              </>
            }
            storageKey={`compendium.${section.category}`}
            defaultOpen={false}
            {...groupProps}
          >
            {section.groups.length > 0
              ? section.groups.map((group) => {
                  const groupKey = `${section.category}:${group.id}`;
                  const foldProps = searching
                    ? {
                        open: !closedGroups.has(groupKey),
                        onToggle: () => setClosedGroups((current) => flip(current, groupKey)),
                      }
                    : {};
                  return (
                    <Group
                      key={group.id}
                      title={group.title}
                      icon={CATEGORY_ICONS[section.category]}
                      count={group.entries.length}
                      storageKey={`compendium.${section.category}.${group.id}`}
                      defaultOpen={false}
                      {...foldProps}
                    >
                      {group.entries.map(card)}
                    </Group>
                  );
                })
              : section.entries.map(card)}
          </PanelSection>
        );
      })}

      {!sections.length && (
        <p className="sg-empty">
          {deferredQuery.trim()
            ? `No entry matches “${deferredQuery.trim()}”. Try another name or key word.`
            : activeFilters
              ? 'No entries match these filters.'
              : 'The compendium is empty.'}
        </p>
      )}

      <Dialog
        open={!!zoom}
        onClose={() => setZoom(null)}
        title={zoom?.alt ?? 'Card artwork'}
        className="daggery-card-preview"
      >
        {zoom && <img src={zoom.src} alt={zoom.alt} />}
      </Dialog>
    </div>
  );
}
