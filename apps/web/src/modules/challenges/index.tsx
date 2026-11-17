import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { IconButton, ItemCard, PanelSection, TONES } from '../../components/Accordion';
import { useDocs } from '../../sync/store';
import type { IronRank } from '@daggery/shared';
import {
  COUNTDOWN_SIZES, RANK_OPTIONS, TRACK_TICKS, TYPE_LABEL, TYPE_ORDER, TYPE_TITLE,
  addTicks, boxTicks, clamp, createCountdown, createTrack, isTrackDoc, markProgress, score, toggleCountdown, trackCaption,
  type CountdownSize, type TrackDoc, type TrackKind,
} from './model';
import './challenges.css';

/** One colour per kind, so the same track reads the same on every visit. */
const TONE: Record<TrackKind, string> = {
  oath: TONES.gold,
  journey: TONES.teal,
  scene: TONES.violet,
  countdown: TONES.red,
};

const TYPE_PLACEHOLDER: Record<TrackKind, string> = {
  oath: 'What did you swear to do?',
  journey: 'Where are you going, and through what?',
  scene: 'What is this scene trying to settle?',
  countdown: 'What happens when the clock fills?',
};

const TYPE_EMPTY: Record<TrackKind, string> = {
  oath: 'No oaths yet. Swear one, then mark progress when you reach a milestone.',
  journey: 'No journeys yet. Give the road a rank and a destination.',
  scene: 'No scenes yet. Name the challenge and see where it goes.',
  countdown: 'No countdowns yet. Fill the segments as the danger closes in.',
};

/**
 * Challenges: progress tracks for a solo Duality GME game.
 *
 * Tracks live in the permitted `gm` namespace as `track:<uuid>` documents.
 * Nothing here rolls: you mark progress with your physical dice and read the
 * number of full boxes as the progress score.
 */
export default function Challenges({ author: _author }: { author: string }) {
  const docs = useDocs<TrackDoc>('gm');
  const [draft, setDraft] = useState<TrackKind | null>(null);
  const tracks = Object.entries(docs.items).filter((entry): entry is [string, TrackDoc] => isTrackDoc(entry[1]));
  const recent = (a: [string, TrackDoc], b: [string, TrackDoc]) => b[1].updated.localeCompare(a[1].updated);
  const active = tracks.filter(([, doc]) => !doc.done);
  const completed = tracks.filter(([, doc]) => doc.done).sort(recent);

  function save(id: string, doc: TrackDoc, changes: Record<string, unknown>) {
    docs.set(id, { ...doc, ...changes, updated: new Date().toISOString() } as TrackDoc);
  }

  function add(type: TrackKind, name: string, rank: IronRank, size: CountdownSize) {
    const id = `track:${crypto.randomUUID()}`;
    docs.set(id, type === 'countdown' ? createCountdown(name, size) : createTrack(type, name, rank));
    setDraft(null);
  }

  return <div className="sg-page challenges-page">
    <header className="challenges-heading">
      <p className="challenges-kicker">Solo play</p>
      <h1><Icon name="target" />Challenges</h1>
      <p>Keep the oaths, journeys, scenes and countdowns that matter. Mark progress from the rank, then count the full boxes for a progress score; the dice stay on the table.</p>
    </header>

    {TYPE_ORDER.map(type => {
      const entries = active.filter(([, doc]) => doc.type === type).sort(recent);
      return <PanelSection
        key={type}
        title={TYPE_TITLE[type]}
        storageKey={`challenges.${type}`}
        actions={<IconButton icon="plus" tone="action" label={`Add ${TYPE_LABEL[type].toLowerCase()}`} onClick={() => setDraft(type)} />}>
        {draft === type && <NewTrackCard type={type} onAdd={(name, rank, size) => add(type, name, rank, size)} onCancel={() => setDraft(null)} />}
        {entries.length === 0
          ? draft === type ? null : <p className="sg-empty">{TYPE_EMPTY[type]}</p>
          : entries.map(([id, doc]) => <TrackCard key={id} id={id} doc={doc} onSave={save} onRemove={docs.remove} />)}
      </PanelSection>;
    })}

    <PanelSection title="Completed" storageKey="challenges.completed" defaultOpen={false}>
      {completed.length === 0
        ? <p className="sg-empty">Completed tracks will rest here. Reopen one to keep playing it.</p>
        : completed.map(([id, doc]) => <TrackCard key={id} id={id} doc={doc} onSave={save} onRemove={docs.remove} />)}
    </PanelSection>
  </div>;
}

function NewTrackCard({ type, onAdd, onCancel }: {
  type: TrackKind;
  onAdd: (name: string, rank: IronRank, size: CountdownSize) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [rank, setRank] = useState<IronRank>('formidable');
  const [size, setSize] = useState<CountdownSize>(8);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, rank, size);
  }

  return <ItemCard defaultOpen title={`New ${TYPE_LABEL[type].toLowerCase()}`} tone={TONE[type]}>
    <form className="challenges-form" onSubmit={submit}>
      <label className="challenges-field">{TYPE_LABEL[type]} name
        <input required maxLength={120} value={name} placeholder={TYPE_PLACEHOLDER[type]} onChange={event => setName(event.target.value)} />
      </label>
      {type === 'countdown'
        ? <label className="challenges-field">Size
            <select aria-label="Countdown size" value={size} onChange={event => setSize(Number(event.target.value) as CountdownSize)}>
              {COUNTDOWN_SIZES.map(value => <option key={value} value={value}>{value} segments</option>)}
            </select>
          </label>
        : <label className="challenges-field">Rank
            <select aria-label="Rank" value={rank} onChange={event => setRank(event.target.value as IronRank)}>
              {RANK_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label} · mark {option.mark} · Difficulty {option.difficulty}</option>)}
            </select>
          </label>}
      <div className="challenges-footer">
        <button className="challenges-btn is-primary" type="submit" disabled={!name.trim()}>Add {TYPE_LABEL[type].toLowerCase()}</button>
        <button className="challenges-btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </ItemCard>;
}

function TrackCard({ id, doc, onSave, onRemove }: {
  id: string;
  doc: TrackDoc;
  onSave: (id: string, doc: TrackDoc, changes: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
}) {
  return <ItemCard
    title={doc.name}
    caption={<span className="challenges-caption"><span>{trackCaption(doc)}</span>{doc.type !== 'countdown' && <TrackBar ticks={doc.ticks} />}</span>}
    tone={TONE[doc.type]}
    actions={<IconButton icon="trash" tone="danger" label={`Delete ${doc.name}`} onClick={() => { if (window.confirm(`Delete “${doc.name}”?`)) onRemove(id); }} />}>
    {doc.type === 'countdown'
      ? <>
          <div className="challenges-segments" role="group" aria-label={`${doc.name}: fill segments`}>
            {Array.from({ length: doc.size }, (_, index) => {
              const filled = index < clamp(doc.filled, 0, doc.size);
              return <button
                key={index}
                type="button"
                className={`challenges-segment${filled ? ' is-filled' : ''}`}
                aria-pressed={filled}
                aria-label={`Segment ${index + 1} of ${doc.size}${filled ? ', filled' : ', empty'}`}
                onClick={() => onSave(id, doc, { filled: toggleCountdown(doc.filled, doc.size, index) })}>
                <span aria-hidden="true" />
              </button>;
            })}
          </div>
          <p className="challenges-score"><strong>{clamp(doc.filled, 0, doc.size)}/{doc.size}</strong> segments filled</p>
        </>
      : <>
          <p className="challenges-score">Progress score: <strong>{score(doc.ticks)}</strong> <span>· {clamp(doc.ticks, 0, TRACK_TICKS)}/{TRACK_TICKS} ticks</span></p>
          <div className="challenges-actions">
            <button type="button" className="challenges-btn is-primary" aria-label={`Mark progress for ${doc.name}`} onClick={() => onSave(id, doc, { ticks: markProgress(doc.ticks, doc.rank) })}>Mark progress</button>
            <button type="button" className="challenges-btn" aria-label={`Remove one tick from ${doc.name}`} onClick={() => onSave(id, doc, { ticks: addTicks(doc.ticks, -1) })}>−1 tick</button>
            <button type="button" className="challenges-btn" aria-label={`Add one tick to ${doc.name}`} onClick={() => onSave(id, doc, { ticks: addTicks(doc.ticks, 1) })}>+1 tick</button>
          </div>
        </>}
    <label className="challenges-field">Notes
      <textarea rows={3} maxLength={4000} value={doc.notes} placeholder="What is at stake, and what changed?" onChange={event => onSave(id, doc, { notes: event.target.value })} />
    </label>
    <div className="challenges-footer">
      <button type="button" className="challenges-btn" onClick={() => onSave(id, doc, { done: !doc.done })}>{doc.done ? 'Reopen' : 'Complete'}</button>
    </div>
  </ItemCard>;
}

/** The compact ten-box bar: each box draws 0 to 4 Ironsworn-style marks. */
function TrackBar({ ticks }: { ticks: number }) {
  return <span className="challenges-bar" aria-hidden="true">
    {boxTicks(ticks).map((count, index) => <span key={index} className="challenges-box" data-ticks={count}><i /><i /></span>)}
  </span>;
}
