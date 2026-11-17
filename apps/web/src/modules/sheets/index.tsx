import { useState } from 'react';
import { useDocs } from '../../sync/store';
import Wizard from './Wizard';
import SheetView from './SheetView';
import { useActiveHero } from './activeHero';
import { Icon } from '../../components/Icon';
import { IconButton, ItemCard, PanelSection, TONES } from '../../components/Accordion';
import { getAncestry, getClass, getCommunity, getSubclass, hpMax, stressMax, tierLabel } from './rules';
import type { Sheet } from './types';
import { portraitImage } from './appearance';
import './sheet.css';

const NEW_HERO = '__new-hero';
const ALL_HEROES = '__all-heroes';

/**
 * Hero-first characters page: the module opens the active hero's sheet directly, and the
 * toolbar switcher moves between heroes or out to the full list. `allHeroes` is the escape
 * hatch back to the library (and the empty state that starts the creation wizard).
 */
export default function SheetsModule({ author }: { author: string }) {
  const { set, remove } = useDocs<Sheet>('sheets');
  const { hero, heroes, select } = useActiveHero();
  const [creating, setCreating] = useState(false);
  const [allHeroes, setAllHeroes] = useState(false);

  if (creating) {
    return (
      <Wizard
        author={author}
        onCancel={() => setCreating(false)}
        onCreate={(sheet) => {
          set(sheet.id, sheet);
          setCreating(false);
          setAllHeroes(false);
          select(sheet.id);
        }}
      />
    );
  }

  if (hero && !allHeroes) {
    return (
      <SheetView
        sheet={hero}
        author={author}
        onBack={() => setAllHeroes(true)}
        onChange={(next) => set(next.id, next)}
        onDelete={() => remove(hero.id)}
        heroNav={
          <HeroSwitcher
            heroes={heroes}
            activeId={hero.id}
            onSelect={(id) => {
              select(id);
              setAllHeroes(false);
            }}
            onNew={() => setCreating(true)}
            onAll={() => setAllHeroes(true)}
          />
        }
      />
    );
  }

  return (
    <div className="sg-page">
      <p className="sg-page-intro">Create your heroes. Bring them to the table.</p>
      <PanelSection
        title="Characters"
        actions={
          <button type="button" onClick={() => setCreating(true)} className="daggery-primary">
            <Icon name="plus" /> New character
          </button>
        }
      >
        {heroes.length === 0 ? (
          <div className="sg-empty">
            <p>No character sheets yet.</p>
            <p>
              Create a character in the guided creation wizard (class, subclass, ancestry, community, traits, equipment,
              Experiences, and domain cards).
            </p>
            <button type="button" onClick={() => setCreating(true)} className="daggery-primary">
              Start creation
            </button>
          </div>
        ) : (
          <div className="daggery-character-grid">
            {heroes.map((sheet) => (
              <SheetCard
                key={sheet.id}
                sheet={sheet}
                onOpen={() => {
                  select(sheet.id);
                  setAllHeroes(false);
                }}
                onDelete={() => {
                  if (window.confirm(`Delete ${sheet.name}'s sheet?`)) remove(sheet.id);
                }}
              />
            ))}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

/** Unobtrusive toolbar menu: pick a hero, jump to the library, or start a new hero. */
function HeroSwitcher({ heroes, activeId, onSelect, onNew, onAll }: {
  heroes: Sheet[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onAll: () => void;
}) {
  return (
    <div className="sheet-hero-switcher">
      {heroes.length > 1 && (
        <label className="sheet-hero-picker">
          <Icon name="sheet" />
          <select
            aria-label="Switch hero"
            value={activeId}
            onChange={(event) => {
              const value = event.target.value;
              if (value === NEW_HERO) onNew();
              else if (value === ALL_HEROES) onAll();
              else onSelect(value);
            }}
          >
            {heroes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            <option value={ALL_HEROES}>All characters…</option>
            <option value={NEW_HERO}>New hero…</option>
          </select>
        </label>
      )}
      <button type="button" className="sheet-ghost is-small sheet-hero-new" onClick={onNew} aria-label="New hero">
        <Icon name="plus" /><span>New hero</span>
      </button>
    </div>
  );
}

function SheetCard({ sheet, onOpen, onDelete }: { sheet: Sheet; onOpen: () => void; onDelete: () => void }) {
  const cls = getClass(sheet.classId);
  const subclass = getSubclass(sheet.classId, sheet.subclassId);
  const ancestry = getAncestry(sheet.ancestryId);
  const mixedAncestry = getAncestry(sheet.mixedAncestryId);
  const community = getCommunity(sheet.communityId);
  const art = sheet.bannerUrl || portraitImage(sheet);
  const [failedArt, setFailedArt] = useState<string | null>(null);
  const heritage = [[ancestry?.name, mixedAncestry?.name].filter(Boolean).join(' / '), community?.name].filter(Boolean).join(' · ');
  return (
    <ItemCard
      title={sheet.name}
      caption={`${cls?.name ?? sheet.classId}${subclass ? ` · ${subclass.name}` : ''} · Level ${sheet.level}`}
      tone={TONES.gold}
      actions={<IconButton icon="sheet" label={`Open ${sheet.name}'s sheet`} tone="action" onClick={onOpen} />}
    >
      <div className="daggery-character-cover">
        {art && failedArt !== art
          ? <img className={`daggery-character-art ${sheet.bannerUrl || sheet.portraitUrl ? 'is-custom' : ''}`} src={art} alt="" loading="lazy" onError={() => setFailedArt(art)} />
          : <span className="daggery-character-placeholder"><Icon name="sheet" /></span>}
        <span className="daggery-character-level">Level <strong>{sheet.level}</strong></span>
      </div>
      <p className="daggery-character-heritage">{heritage || 'No heritage defined'}</p>
      <p className="daggery-character-meta"><span>{tierLabel(sheet.level)}</span><span>Proficiency {sheet.proficiency}</span></p>
      <dl className="daggery-character-resources">
        <div><dt><Icon name="heart" /><span>HP<small>marked</small></span></dt><dd>{sheet.hpMarked}<span> / {hpMax(sheet)}</span></dd></div>
        <div><dt><Icon name="stress" /><span>Stress<small>marked</small></span></dt><dd>{sheet.stressMarked}<span> / {stressMax(sheet)}</span></dd></div>
        <div><dt><Icon name="spark" /><span>Hope<small>available</small></span></dt><dd>{sheet.hope}<span> / 6</span></dd></div>
      </dl>
      <div className="daggery-character-card-footer">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700"
        >
          <Icon name="sheet" />
          Open sheet
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${sheet.name}`}
          className="text-xs text-rose-400 hover:text-rose-300"
        >
          <Icon name="trash" />
        </button>
      </div>
    </ItemCard>
  );
}
