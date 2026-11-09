import { useMemo, useState } from 'react';
import { useDocs } from '../../sync/store';
import Wizard from './Wizard';
import SheetView from './SheetView';
import { Icon } from '../../components/Icon';
import { bringCharacterToTable } from '../../table-navigation';
import { getAncestry, getClass, getCommunity, getSubclass, hpMax, stressMax, tierLabel, classArt } from './rules';
import type { Sheet } from './types';

export default function SheetsModule({ author }: { author: string }) {
  const { items, set, remove } = useDocs<Sheet>('sheets');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sheets = useMemo(
    () => Object.values(items).sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? '')),
    [items],
  );

  const selected = selectedId ? items[selectedId] : undefined;

  if (creating) {
    return (
      <Wizard
        author={author}
        onCancel={() => setCreating(false)}
        onCreate={(sheet) => {
          set(sheet.id, sheet);
          setCreating(false);
          setSelectedId(sheet.id);
        }}
      />
    );
  }

  if (selected) {
    return (
      <SheetView
        sheet={selected}
        author={author}
        onBack={() => setSelectedId(null)}
        onPlay={() => bringCharacterToTable(selected.id)}
        onChange={(next) => set(next.id, next)}
        onDelete={() => {
          remove(selected.id);
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="daggery-character-library">
      <header className="daggery-character-heading">
        <div className="min-w-0 flex-1">
          <h1 className="text-slate-100">Your characters</h1>
          <p className="text-sm text-slate-500">Create your heroes. Bring them to the table.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="daggery-primary">
          <Icon name="plus" /> New character
        </button>
      </header>

      {sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
          <p className="text-slate-300">No character sheets yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Create a character in the guided creation wizard (class, subclass, ancestry, community, traits, equipment,
            Experiences, and domain cards).
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-accent-400"
          >
            Start creation
          </button>
        </div>
      ) : (
        <ul className="daggery-character-grid">
          {sheets.map((sheet) => (
            <SheetCard
              key={sheet.id}
              sheet={sheet}
              onOpen={() => setSelectedId(sheet.id)}
              onDelete={() => {
                if (window.confirm(`Delete ${sheet.name}'s sheet?`)) {
                  remove(sheet.id);
                  if (selectedId === sheet.id) setSelectedId(null);
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SheetCard({ sheet, onOpen, onDelete }: { sheet: Sheet; onOpen: () => void; onDelete: () => void }) {
  const cls = getClass(sheet.classId);
  const subclass = getSubclass(sheet.classId, sheet.subclassId);
  const ancestry = getAncestry(sheet.ancestryId);
  const mixedAncestry = getAncestry(sheet.mixedAncestryId);
  const community = getCommunity(sheet.communityId);
  return (
    <li className="daggery-character-card">
      {classArt(sheet.classId) && <img className="daggery-character-art" src={classArt(sheet.classId)} alt="" />}
      <div className="daggery-character-card-body">
        <button type="button" onClick={onOpen} className="text-left">
          <p className="text-lg font-semibold text-slate-100">{sheet.name}</p>
          <p className="text-xs text-slate-400">
            {cls?.name ?? sheet.classId}
            {subclass ? ` · ${subclass.name}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[[ancestry?.name, mixedAncestry?.name].filter(Boolean).join(' / '), community?.name].filter(Boolean).join(' · ') ||
              'No heritage defined'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Level {sheet.level} · {tierLabel(sheet.level)} · Prof. {sheet.proficiency}
          </p>
        </button>
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-xs">
          <span className="rounded bg-rose-950/50 px-2 py-1 text-rose-200">
            HP {hpMax(sheet) - sheet.hpMarked}/{hpMax(sheet)}
          </span>
          <span className="rounded bg-violet-950/50 px-2 py-1 text-violet-200">
            Stress {stressMax(sheet) - sheet.stressMarked}/{stressMax(sheet)}
          </span>
          <span className="rounded bg-accent-950/50 px-2 py-1 text-accent-200">Hope {sheet.hope}/6</span>
        </div>
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
            aria-label={`Bring ${sheet.name} to table`}
            title="Bring to table"
            onClick={() => bringCharacterToTable(sheet.id)}
          >
            <Icon name="map" />
            Table
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
      </div>
    </li>
  );
}
