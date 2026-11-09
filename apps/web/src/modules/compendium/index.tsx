import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { cardUrl } from '@daggery/content';
import { Icon, type IconName } from '../../components/Icon';
import { inventoryItemIcon, inventoryIconTone } from '../sheets/inventoryIcons';
import { Dialog } from '../../components/Dialog';
import { Chip, type ZoomRequest } from './components';
import {
  ALL_ENTRIES,
  CATEGORIES,
  CLASS_OPTIONS,
  DOMAIN_OPTIONS,
  EMPTY_FILTERS,
  ENTRY_BY_KEY,
  ENTRIES_BY_CATEGORY,
  ENTRY_KIND_LABEL,
  LEVEL_OPTIONS,
  TIER_OPTIONS,
  categoryForKind,
  categoryLabel,
  entriesForCategory,
  entrySubtitle,
  filterEntries,
  filterFieldsFor,
  hasActiveFilters,
  typeOptionsFor,
  type CategoryId,
  type Entry,
  type FilterField,
  type Filters,
} from './data';
import { EntryDetail } from './detail';
import './compendium.css';

const FILTER_LABELS: Record<FilterField, string> = {
  domain: 'Domain',
  level: 'Level',
  tier: 'Tier',
  type: 'Type',
  classId: 'Class',
};
const PAGE_SIZE = 80;
const CATEGORY_ICONS:Record<CategoryId,IconName> = {classes:'sheet',domainCards:'magic',ancestries:'ancestry',communities:'users',weapons:'weapon',armor:'armor',items:'backpack',consumables:'potion',adversaries:'adversary',environments:'tree',conditions:'target',transformations:'paw'};
function EntryGlyph({entry}:{entry:Entry}) {
  const kind=entry.kind;
  const icon=kind==='weapon'||kind==='armor'||kind==='item'||kind==='consumable'?inventoryItemIcon({kind,name:entry.name}):CATEGORY_ICONS[categoryForKind(kind)];
  return <span className="compendium-entry-emblem item-glyph" data-tone={inventoryIconTone(icon)}><Icon name={icon} /></span>;
}


export default function CompendiumModule({ author }: { author: string }) {
  const [category, setCategory] = useState<CategoryId>('classes');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomRequest | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [width, setWidth] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const wide = width >= 1020;
  const searching = !!deferredQuery.trim();
  const selected = selectedKey ? ENTRY_BY_KEY.get(selectedKey) : undefined;
  const source = useMemo(() => (searching ? [...ALL_ENTRIES] : entriesForCategory(category)), [category, searching]);
  const { entries, matchedBeforeFilters } = useMemo(
    () => filterEntries(source, filters, deferredQuery),
    [source, filters, deferredQuery],
  );
  const fields = filterFieldsFor(category, searching),
    typeOptions = typeOptionsFor(category, searching);
  const counts = useMemo(() => {
    const result = Object.fromEntries(
      CATEGORIES.map((item) => [item.id, searching ? 0 : ENTRIES_BY_CATEGORY[item.id].length]),
    ) as Record<CategoryId, number>;
    if (searching) for (const entry of matchedBeforeFilters) result[categoryForKind(entry.kind)]++;
    return result;
  }, [matchedBeforeFilters, searching]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [category, deferredQuery, filters]);
  useEffect(() => {
    if (selectedKey && !entries.some((entry) => entry.key === selectedKey)) setSelectedKey(null);
  }, [entries, selectedKey]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !zoom) setSelectedKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);
  function chooseCategory(id: CategoryId) {
    setCategory(id);
    setQuery('');
    setFilters(EMPTY_FILTERS);
    setSelectedKey(null);
  }
  const detail = selected && <EntryDetail entry={selected} author={author} onZoom={setZoom} />;
  return (
    <div ref={root} className={`daggery-compendium compendium-browser ${wide ? 'is-wide' : ''}`}>
      <header className="compendium-header">
        <div>
          <span className="compendium-eyebrow">YOUR REFERENCE LIBRARY</span>
          <h1>Compendium</h1>
        </div>
        <label className="compendium-search">
          <Icon name="search" />
          <input
            aria-label="Search the compendium"
            placeholder="Search names, features, or rules…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="close" />
            </button>
          )}
        </label>
      </header>
      <div className="compendium-body">
        <nav className="compendium-categories" aria-label="Compendium categories">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={!searching && item.id === category ? 'page' : undefined}
              onClick={() => chooseCategory(item.id)}
            >
              <Icon name={CATEGORY_ICONS[item.id]} /><span>{item.label}</span>
              <small>{counts[item.id]}</small>
            </button>
          ))}
        </nav>
        <section className="compendium-results" aria-label="Compendium entries">
          <div className="compendium-results-heading">
            <div>
              <h2>{searching ? 'Search results' : categoryLabel(category)}</h2>
              <span role="status">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <select
              className="compendium-category-select"
              aria-label="Category"
              value={category}
              onChange={(e) => chooseCategory(e.target.value as CategoryId)}
            >
              {CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {!!fields.length && (
            <div className="compendium-filters">
              {fields.map((field) => (
                <label key={field}>
                  {FILTER_LABELS[field]}
                  <select
                    aria-label={FILTER_LABELS[field]}
                    value={filters[field]}
                    onChange={(e) => setFilters((current) => ({ ...current, [field]: e.target.value }))}
                  >
                    <option value="">All</option>
                    {(field === 'domain'
                      ? DOMAIN_OPTIONS
                      : field === 'level'
                        ? LEVEL_OPTIONS
                        : field === 'tier'
                          ? TIER_OPTIONS
                          : field === 'classId'
                            ? CLASS_OPTIONS
                            : typeOptions
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {hasActiveFilters(filters) && (
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div className="compendium-list-scroll">
            <ul className="compendium-entry-list">
              {entries.slice(0, visible).map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    aria-label={`Read ${entry.name}`}
                    aria-current={selectedKey === entry.key ? 'true' : undefined}
                    onClick={() => setSelectedKey(entry.key)}
                  >
                    <EntryGlyph entry={entry} /><span className="compendium-entry-label">
                      <strong>{entry.name}</strong>
                      <small>{entrySubtitle(entry)}</small>
                    </span>
                    {searching && <Chip>{ENTRY_KIND_LABEL[entry.kind]}</Chip>}
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
            {!entries.length && (
              <div className="compendium-empty">
                <Icon name="search" />
                <h3>No entries found</h3>
                <p>Try another search or clear your filters.</p>
              </div>
            )}
            {visible < entries.length && (
              <button className="compendium-load-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
                Show more ({entries.length - visible} remaining)
              </button>
            )}
          </div>
        </section>
        {wide && (
          <aside className="compendium-reader" aria-label="Entry details">
            {selected ? (
              <>
                <div className="compendium-reader-heading">
                  <span>{ENTRY_KIND_LABEL[selected.kind]}</span>
                  <button type="button" aria-label="Close detail" onClick={() => setSelectedKey(null)}>
                    <Icon name="close" />
                  </button>
                </div>
                <div className="compendium-reader-scroll">{detail}</div>
              </>
            ) : (
              <div className="compendium-empty">
                <Icon name="book" />
                <h2>Find your next idea.</h2>
                <p>Choose an entry to read its rules and features.</p>
              </div>
            )}
          </aside>
        )}
      </div>
      <Dialog
        open={!wide && !!selected}
        onClose={() => setSelectedKey(null)}
        title={selected?.name ?? 'Entry details'}
        className="compendium-reader-dialog"
      >
        <div className="compendium-reader-scroll">{detail}</div>
      </Dialog>
      <Dialog open={!!zoom} onClose={() => setZoom(null)} title={zoom?.alt ?? 'Card artwork'} className="daggery-card-preview">
        {zoom && <img src={zoom.src} alt={zoom.alt} />}
      </Dialog>
    </div>
  );
}
