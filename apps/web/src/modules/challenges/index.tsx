import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { IconButton, ItemCard, PanelSection, TONES } from '../../components/Accordion';
import { useDocs } from '../../sync/store';
import { adversaries } from '@daggery/content';
import { initiativeLabelFor, setInitiative, turnTheTide, type IronRank, type PackSize } from '@daggery/shared';
import { FightMomentum } from '../../systems/FightMomentum';
import { signed, useMomentum } from '../../systems/useMomentum';
import '../../systems/trackers.css';
import {
  COUNTDOWN_SIZES, RANK_OPTIONS, TRACK_TICKS, TYPE_LABEL, TYPE_ORDER, TYPE_TITLE,
  addTicks, boxTicks, clamp, createCountdown, createTrack, harmFromFoe, inflictHarm, isTrackDoc, markProgress, progressTicks, rankForAdversary, rankLabel, score, toggleCountdown, trackCaption,
  type CountdownSize, type ProgressTrackDoc, type TrackDoc, type TrackKind,
} from './model';
import './challenges.css';

/** One colour per kind, so the same track reads the same on every visit. */
const TONE: Record<TrackKind, string> = {
  oath: TONES.gold,
  fight: TONES.orange,
  journey: TONES.teal,
  bond: TONES.pink,
  scene: TONES.violet,
  countdown: TONES.red,
};

const TYPE_PLACEHOLDER: Record<TrackKind, string> = {
  oath: 'What did you swear to do?',
  fight: 'Who or what do you fight?',
  bond: 'Bonds',
  journey: 'Where are you going, and through what?',
  scene: 'What is this scene trying to settle?',
  countdown: 'What happens when the clock fills?',
};

const TYPE_EMPTY: Record<TrackKind, string> = {
  oath: 'No vows yet. Swear an Iron Vow, then mark progress when you reach a milestone.',
  fight: 'No fights. Enter the Fray: give each foe, or each pack, a rank and a track.',
  bond: 'No bonds yet. Forge a Bond, and mark a tick for each one.',
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

  function add(type: TrackKind, name: string, rank: IronRank, size: CountdownSize, extra?: { adversary?: string; pack?: PackSize }) {
    const id = `track:${crypto.randomUUID()}`;
    docs.set(id, type === 'countdown' ? createCountdown(name, size) : { ...createTrack(type, name, rank), ...extra });
    setDraft(null);
  }

  return <div className="sg-page challenges-page">
    <header className="challenges-heading">
      <p className="challenges-kicker">Solo play</p>
      <h1><Icon name="target" />Challenges</h1>
      <p>Keep the vows, fights, journeys, bonds, scenes and countdowns that matter. Mark progress from the rank, then count the full boxes for a progress score. Roll the challenge dice (two d10) against it on the table.</p>
    </header>

    {TYPE_ORDER.map(type => {
      const entries = active.filter(([, doc]) => doc.type === type).sort(recent);
      return <PanelSection
        key={type}
        title={TYPE_TITLE[type]}
        storageKey={`challenges.${type}`}
        actions={<IconButton icon="plus" tone="action" label={`Add ${TYPE_LABEL[type].toLowerCase()}`} onClick={() => setDraft(type)} />}>
        {type === 'fight' && <InitiativeBar />}
        {draft === type && <NewTrackCard type={type} onAdd={(name, rank, size, extra) => add(type, name, rank, size, extra)} onCancel={() => setDraft(null)} />}
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

/** Who has initiative in the fight, and Turn the Tide. The same tracker as the top bar. */
function InitiativeBar() {
  const { tracker, update } = useMomentum();
  const fighting = tracker.initiative !== null;
  return <div className="tracker is-momentum is-inline challenges-initiative" data-negative={tracker.value < 0 || undefined} role="group" aria-label="Initiative">
    <div className="challenges-initiative-head">
      <span><Icon name="spark" />Momentum <strong>{signed(tracker.value)}</strong></span>
      <span><Icon name="backpack" />Supply <strong>{tracker.supply}</strong></span>
    </div>
    <div className="tracker-segments" role="group" aria-label="Who has initiative">
      <button type="button" aria-pressed={tracker.initiative === null} onClick={() => update(current => setInitiative(current, null))}>No fight</button>
      <button type="button" className="is-hero" aria-pressed={tracker.initiative === 'hero'} onClick={() => update(current => setInitiative(current, 'hero'))}><Icon name="shield" />You</button>
      <button type="button" className="is-foe" aria-pressed={tracker.initiative === 'foe'} onClick={() => update(current => setInitiative(current, 'foe'))}><Icon name="adversary" />Foe</button>
    </div>
    {fighting && <p className={`tracker-state${tracker.initiative === 'foe' ? ' is-foe' : ''}`} role="status"><Icon name={tracker.initiative === 'hero' ? 'combat' : 'adversary'} /><span>{initiativeLabelFor(tracker.initiative)}</span></p>}
    {fighting && <button type="button" className="tracker-action" disabled={tracker.tideTurned} onClick={() => update(turnTheTide)}>
      <Icon name="rotate" /><strong>Turn the Tide</strong><small>{tracker.tideTurned ? 'Used this fight' : 'Once per fight: steal initiative'}</small>
    </button>}
    <FightMomentum tracker={tracker} />
  </div>;
}

function NewTrackCard({ type, onAdd, onCancel }: {
  type: TrackKind;
  onAdd: (name: string, rank: IronRank, size: CountdownSize, extra?: { adversary?: string; pack?: PackSize }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(type === 'bond' ? 'Bonds' : '');
  const [rank, setRank] = useState<IronRank>('formidable');
  const [size, setSize] = useState<CountdownSize>(8);
  const [adversary, setAdversary] = useState('');
  const [pack, setPack] = useState<PackSize>('single');
  const stat = type === 'fight' ? adversaries.find(item => item.name.toLowerCase() === adversary.trim().toLowerCase()) : undefined;
  // A Daggerheart adversary sets the rank itself: its tier and type, raised if you fight a pack of them.
  const derived: IronRank | null = stat ? rankForAdversary(stat.type, stat.tier, pack) : null;
  const effective = derived ?? rank;

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = (name.trim() || stat?.name || '').trim();
    if (!trimmed) return;
    onAdd(trimmed, effective, size, stat ? { adversary: stat.id, pack } : undefined);
  }

  return <ItemCard defaultOpen title={`New ${TYPE_LABEL[type].toLowerCase()}`} tone={TONE[type]}>
    <form className="challenges-form" onSubmit={submit}>
      {type === 'fight' && <>
        <label className="challenges-field">Daggerheart adversary (optional)
          <input list="challenges-adversaries" value={adversary} maxLength={80} placeholder="Type a name to set the rank from its tier and type" onChange={event => setAdversary(event.target.value)} />
          <datalist id="challenges-adversaries">{adversaries.map(item => <option key={item.id} value={item.name}>{`Tier ${item.tier} ${item.type}`}</option>)}</datalist>
        </label>
        <label className="challenges-field">Fighting
          <select aria-label="Pack size" value={pack} onChange={event => setPack(event.target.value as PackSize)}>
            <option value="single">One foe</option>
            <option value="small">A small pack (3 to 5): rank +1</option>
            <option value="large">A large pack (6 to 10): rank +2</option>
          </select>
        </label>
        {stat && <p className="challenges-hint">Tier {stat.tier} {stat.type}{pack === 'single' ? '' : ' pack'}: <strong>{rankLabel(effective)}</strong> foe. It deals {harmFromFoe(effective)} harm to you.</p>}
      </>}
      {type !== 'bond' && <label className="challenges-field">{TYPE_LABEL[type]} name
        <input required={!stat} maxLength={120} value={name} placeholder={stat && type === 'fight' ? stat.name : TYPE_PLACEHOLDER[type]} onChange={event => setName(event.target.value)} />
      </label>}
      {type === 'countdown'
        ? <label className="challenges-field">Size
            <select aria-label="Countdown size" value={size} onChange={event => setSize(Number(event.target.value) as CountdownSize)}>
              {COUNTDOWN_SIZES.map(value => <option key={value} value={value}>{value} segments</option>)}
            </select>
          </label>
        : type === 'bond' ? <p className="challenges-hint">Ironsworn keeps one bonds track: a tick for each bond. Four bonds fill a box.</p>
        : <label className="challenges-field">Rank
            <select aria-label="Rank" value={effective} disabled={derived !== null} onChange={event => setRank(event.target.value as IronRank)}>
              {RANK_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label} · mark {option.mark} · Difficulty {option.difficulty}</option>)}
            </select>
          </label>}
      <div className="challenges-footer">
        <button className="challenges-btn is-primary" type="submit" disabled={type !== 'bond' && !name.trim() && !stat}>Add {TYPE_LABEL[type].toLowerCase()}</button>
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
          {doc.type === 'fight' && <div className="challenges-badges" aria-label="Foe">
            <span className="challenges-badge is-rank"><Icon name="adversary" />{rankLabel(doc.rank)} foe</span>
            <span className="challenges-badge is-harm"><Icon name="heart" />Deals {harmFromFoe(doc.rank)} harm</span>
            <span className="challenges-badge"><Icon name="combat" />Each harm marks {RANK_OPTIONS.find(option => option.id === doc.rank)!.mark}</span>
          </div>}
          {doc.type === 'bond' && <div className="challenges-badges" aria-label="Bonds">
            <span className="challenges-badge is-rank"><Icon name="users" />{clamp(doc.ticks, 0, TRACK_TICKS)} {clamp(doc.ticks, 0, TRACK_TICKS) === 1 ? 'bond' : 'bonds'}</span>
            <span className="challenges-badge">While you share a bond, many moves give +2</span>
          </div>}
          <div className="challenges-actions">
            {doc.type === 'fight'
              ? <>
                {[1, 2, 3].map(harm => <button key={harm} type="button" className={`challenges-btn is-harm${harm === 2 ? ' is-primary' : ''}`} aria-label={`Inflict ${harm} harm on ${doc.name}`}
                  onClick={() => onSave(id, doc, { ticks: inflictHarm(doc.ticks, doc.rank, harm) })}>Inflict {harm} harm</button>)}
              </>
              : <button type="button" className="challenges-btn is-primary" aria-label={`Mark progress for ${doc.name}`}
                onClick={() => onSave(id, doc, { ticks: doc.type === 'bond' ? addTicks(doc.ticks, progressTicks('bond', doc.rank)) : markProgress(doc.ticks, doc.rank) })}>{doc.type === 'bond' ? 'Forge a bond' : 'Mark progress'}</button>}
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
