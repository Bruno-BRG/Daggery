/** Duality GME: oaths, moves and progress tracks on Daggerheart. Rules: docs/solo-rules-gme.md. */
import { useState } from 'react';
import {
  IRON_CLOCK_SIZES, IRON_LIKELIHOODS, IRON_MOVE_GROUPS, IRON_MOVES, IRON_RANKS, IRON_TRACK_TICKS, ironProgressScore, markIronProgress,
  SOLO_PROGRESS_LIMIT, type IronMove, type SoloProgressTrack,
} from '@daggery/shared';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { diceModeFor, setDiceMode, type DiceMode } from './diceMode';
import { CombatStep, Journey, landed, LookupTable, ResultCard, Step, useRolled, validDie, type Play } from './parts';

const LOOP: [string, string][] = [
  ['iron-session', 'Begin a Session'], ['iron-oaths', 'Oaths'], ['iron-moves', 'Make a move'], ['iron-oracle', 'Ask the Oracle'],
  ['iron-scene', 'Scene challenge'], ['iron-expedition', 'Expeditions'], ['iron-connections', 'Connections'], ['step-combat', 'Combat'], ['iron-end', 'End a Session'],
];
const generate = (tableId: string) => ({ tableId });

export function IronPlay({ play }: { play: Play }) {
  return <Journey steps={LOOP} title="Your next move" hint="Follow your oaths. Make a move when the fiction calls for it, and discover what happens next.">
    <SessionStep play={play} />
    <OathStep play={play} />
    <MoveStep play={play} />
    <OracleStep play={play} />
    <TrackStep play={play} n="5" id="iron-scene" kind="scene" title="Scene challenge"
      hint="For a tense scene against a threat or a clock. Name the objective (Grave) and set a tension clock: 4 at a disadvantage, 6 on even footing, 8 with an advantage. Strong hit: mark progress. Weak hit: mark progress and fill a segment. Miss: fill a segment (2 on a failure with Fear) and Pay the Price. Finish the Scene with a progress roll."
      placeholder="Slip past the gate guards" fixedRank="formidable" />
    <ExpeditionStep play={play} />
    <TrackStep play={play} n="7" id="iron-connections" kind="connection" title="Connections"
      hint="Make a Connection (Presence) to add someone with a role and a rank. Develop Your Relationship marks progress when you share a meaningful moment. Forge a Bond with a progress roll: on a strong hit, once per session they can help you with an advantage die (d6)."
      placeholder="Mara Coldwater, the ferrywoman" />
    <CombatStep play={play} n="8" />
    <Step n="9" id="iron-end" title="End a Session" hint="Note where you stopped. If there is an oath, connection or situation you want to focus on next time, note it and gain a Hope.">
      <MoveCards ids={['take-break', 'end-session', 'set-flag', 'change-fate']} />
    </Step>
  </Journey>;
}

function SessionStep({ play }: { play: Play }) {
  const [vignette, roll] = useRolled(play);
  return <Step n="1" id="iron-session" title="Begin a Session" hint="Set or review your flags, recap where you left off, and set the scene: where you are and what you intend. You may spotlight a danger, opportunity or insight elsewhere: roll a Vignette, envision it, and gain a Hope as you return to your character."
    tables={<LookupTable id="iron-vignette" hits={landed([vignette])} />}>
    <div className="solo-actions"><button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void roll('duality-generate', generate('iron-vignette'))}><Icon name="dice" />Roll a Vignette</button></div>
    <div aria-live="polite">{vignette && <ResultCard key={vignette.id} entry={vignette} play={play} />}</div>
  </Step>;
}

function OathStep({ play }: { play: Play }) {
  const [hook, rollHook] = useRolled(play);
  return <TrackStep play={play} n="2" id="iron-oaths" kind="vow" title="Oaths"
    hint="Take an Oath (Presence vs the rank's Difficulty) on an inciting incident. Reach a Milestone marks progress at the oath's rank; Keep Your Oath is a progress roll. Keeping a Serious or harder oath is a levelling milestone."
    placeholder="Avenge the burning of Ashford"
    extra={<>
      <div className="solo-actions"><button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void rollHook('duality-plot', { question: 'Inciting incident' })}><Icon name="dice" />Roll an inciting incident</button></div>
      <div aria-live="polite">{hook && <ResultCard key={hook.id} entry={hook} play={play} />}</div>
      <MoveCards ids={['swear-vow', 'milestone', 'fulfill-vow', 'forsake-vow']} />
    </>}
    tables={<><LookupTable id="plot-hook" hits={landed([hook])} open={false} /><LookupTable id="plot-stakes" hits={landed([hook])} open={false} /></>} />;
}

const RESULTS = [
  { id: 'critical', label: 'Critical success', outcome: 'strong' }, { id: 'hope-success', label: 'Success with Hope', outcome: 'strong' },
  { id: 'fear-success', label: 'Success with Fear', outcome: 'weak' }, { id: 'hope-failure', label: 'Failure with Hope', outcome: 'miss' },
  { id: 'fear-failure', label: 'Failure with Fear', outcome: 'miss' },
] as const;
const ROLLED_MOVES = IRON_MOVES.filter(move => move.strong);

/** Reads a Daggerheart action roll as a move outcome, and pays the price on a miss. */
function MoveStep({ play }: { play: Play }) {
  const [moveId, setMoveId] = useState('face-danger');
  const [result, setResult] = useState<(typeof RESULTS)[number]['id'] | null>(null);
  const [price, rollPrice] = useRolled(play);
  const move = IRON_MOVES.find(item => item.id === moveId)!;
  const read = RESULTS.find(item => item.id === result);
  const outcome = read ? { strong: move.strong, weak: move.weak, miss: move.miss }[read.outcome] : undefined;
  return <Step n="3" id="iron-moves" title="Make a move" hint="Envision what your character does. When it matches a move, make the Daggerheart action roll it names, then tell the engine how it went. A miss means Pay the Price; a failure with Fear lets the GM spend 1 Fear to make it severe."
    tables={<><LookupTable id="iron-price" hits={landed([price])} /><MoveReference /></>}>
    <label className="solo-field">Move<select value={moveId} onChange={change => { setMoveId(change.target.value); setResult(null); }}>
      {IRON_MOVE_GROUPS.map(group => {
        const moves = ROLLED_MOVES.filter(item => item.group === group.id);
        return moves.length ? <optgroup key={group.id} label={group.label}>{moves.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup> : null;
      })}
    </select></label>
    <p className="solo-muted"><i>{move.trigger}</i>{move.roll ? <> Roll: <b>{move.roll}</b>.</> : null}</p>
    <div className="solo-likelihoods solo-results" role="radiogroup" aria-label="Your action roll">
      {RESULTS.map(item => <button key={item.id} type="button" role="radio" aria-checked={result === item.id} onClick={() => setResult(item.id)}>{item.label}<small>{item.outcome === 'strong' ? 'Strong hit' : item.outcome === 'weak' ? 'Weak hit' : 'Miss'}</small></button>)}
    </div>
    {read && <div className={`solo-result solo-tone-${read.outcome === 'strong' ? 'hope' : read.outcome === 'miss' ? 'fear' : 'neutral'}`} aria-live="polite">
      <p className="solo-result-kind">{move.name} · {read.label}</p>
      <strong className="solo-result-title">{read.outcome === 'strong' ? 'Strong hit' : read.outcome === 'weak' ? 'Weak hit' : 'Miss'}</strong>
      <p className="solo-result-detail">{outcome}</p>
      {read.outcome === 'miss' && <div className="solo-actions">
        <button type="button" className="daggery-primary" disabled={play.busy} onClick={() => void rollPrice('iron-price', { question: `${move.name}: Pay the Price` })}><Icon name="dice" />Pay the Price</button>
        {read.id === 'fear-failure' && <button type="button" className="daggery-roll-toggle" disabled={play.busy || play.fear < 1} onClick={() => void rollPrice('iron-price', { severe: true, question: `${move.name}: Pay the Price (severe)` })}><Icon name="dice" />Severe price (1 Fear)</button>}
      </div>}
    </div>}
    <div aria-live="polite">{price && <ResultCard key={price.id} entry={price} play={play} />}</div>
  </Step>;
}

/** Every move with its trigger and outcomes, by group. */
function MoveReference() {
  return <details className="solo-table">
    <summary><span className="solo-table-title">All moves</span><span className="solo-chip">{IRON_MOVES.length}</span></summary>
    <div className="solo-move-reference">{IRON_MOVE_GROUPS.map(group => <section key={group.id}>
      <h4>{group.label}</h4>
      <MoveCards ids={IRON_MOVES.filter(move => move.group === group.id).map(move => move.id)} />
    </section>)}</div>
  </details>;
}
function MoveCards({ ids }: { ids: string[] }) {
  const moves = ids.map(id => IRON_MOVES.find(move => move.id === id)).filter((move): move is IronMove => !!move);
  return <dl className="solo-moves">{moves.map(move => <div key={move.id} className="solo-move">
    <dt>{move.name}{move.roll ? <small> · {move.roll}</small> : null}</dt>
    <dd><i>{move.trigger}</i></dd>
    {move.text && <dd>{move.text}</dd>}
    {move.strong && <dd><b className="is-strong">Strong hit:</b> {move.strong}</dd>}
    {move.weak && <dd><b className="is-weak">Weak hit:</b> {move.weak}</dd>}
    {move.miss && <dd><b className="is-miss">Miss:</b> {move.miss}</dd>}
  </div>)}</dl>;
}

function OracleStep({ play }: { play: Play }) {
  const campaign = getActiveCampaign();
  const [question, setQuestion] = useState('');
  const [likelihood, setLikelihood] = useState('even');
  const [mode, setMode] = useState<DiceMode>(() => diceModeFor(campaign.id));
  const [hopeDie, setHopeDie] = useState('');
  const [fearDie, setFearDie] = useState('');
  const [answer, ask] = useRolled(play);
  const [meaning, rollMeaning] = useRolled(play);
  const physical = mode === 'physical';
  const ready = !physical || (validDie(hopeDie, 12) && validDie(fearDie, 12));
  const chooseMode = (next: DiceMode) => { setMode(next); setDiceMode(campaign.id, next); };
  async function submit() {
    const entry = await ask('iron-oracle', { question: question.trim(), likelihood, ...(physical ? { dice: { hope: Number(hopeDie), fear: Number(fearDie) } } : {}) });
    if (entry) { setQuestion(''); setHopeDie(''); setFearDie(''); }
  }
  return <Step n="4" id="iron-oracle" title="Ask the Oracle" hint="Pick a likelihood and roll the Duality Dice. If they match (doubles), the answer comes with an extreme result or a twist. For open questions, roll Meaning."
    tables={<><LookupTable id="action" hits={landed([meaning])} /><LookupTable id="subject" hits={landed([meaning])} open={false} /></>}>
    <form className="solo-oracle-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="solo-field">Question (optional)<input value={question} maxLength={2000} onChange={change => setQuestion(change.target.value)} placeholder="Does anyone follow me?" /></label>
      <div className="solo-likelihoods" role="radiogroup" aria-label="Likelihood">
        {IRON_LIKELIHOODS.map(row => <button key={row.id} type="button" role="radio" aria-checked={likelihood === row.id} onClick={() => setLikelihood(row.id)}>{row.label}<small>{row.chance}</small></button>)}
      </div>
      <div className="solo-row">
        <div className="solo-dice-mode" role="group" aria-label="Dice">
          <button type="button" aria-pressed={!physical} onClick={() => chooseMode('digital')}>Digital dice</button>
          <button type="button" aria-pressed={physical} onClick={() => chooseMode('physical')}>My physical dice</button>
        </div>
        {physical && <div className="solo-dice-fields">
          <label className="solo-field">Hope d12<input inputMode="numeric" value={hopeDie} maxLength={2} onChange={change => setHopeDie(change.target.value)} placeholder="1-12" /></label>
          <label className="solo-field">Fear d12<input inputMode="numeric" value={fearDie} maxLength={2} onChange={change => setFearDie(change.target.value)} placeholder="1-12" /></label>
        </div>}
        <button className="daggery-primary" disabled={play.busy || !ready}><Icon name="dice" />Ask the Oracle</button>
      </div>
    </form>
    <div aria-live="polite">{answer && <ResultCard key={answer.id} entry={answer} play={play} />}</div>
    <div className="solo-actions"><button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void rollMeaning('duality-meaning', { choice: 'action-subject', count: 1 })}><Icon name="dice" />Roll Meaning (Action + Subject)</button></div>
    <div aria-live="polite">{meaning && <ResultCard key={meaning.id} entry={meaning} play={play} />}</div>
  </Step>;
}

function ExpeditionStep({ play }: { play: Play }) {
  const [found, roll] = useRolled(play);
  const hits = landed([found]);
  return <TrackStep play={play} n="6" id="iron-expedition" kind="expedition" title="Expeditions"
    hint="Undertake an Expedition across dangerous ground: give it a rank and roll each segment (Instinct, Agility or Knowledge vs the rank's Difficulty). Strong hit: mark progress, reach a waypoint. Weak hit: mark progress and suffer a cost. Miss: Pay the Price. Finish an Expedition with a progress roll."
    placeholder="Cross the Mossgrave marsh"
    extra={<>
      <div className="solo-actions">
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void roll('duality-generate', generate('iron-waypoint'))}><Icon name="dice" />Waypoint</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void roll('duality-generate', generate('iron-opportunity'))}><Icon name="dice" />Find an Opportunity</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void roll('duality-generate', generate('iron-discovery'))}><Icon name="dice" />Make a Discovery</button>
        <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => void roll('duality-generate', generate('iron-chaos'))}><Icon name="dice" />Confront Chaos</button>
      </div>
      <div aria-live="polite">{found && <ResultCard key={found.id} entry={found} play={play} />}</div>
      <MoveCards ids={['undertake-expedition', 'explore-waypoint']} />
    </>}
    tables={<><LookupTable id="iron-waypoint" hits={hits} /><LookupTable id="iron-opportunity" hits={hits} /><LookupTable id="iron-discovery" hits={hits} open={false} /><LookupTable id="iron-chaos" hits={hits} open={false} /></>} />;
}

/** One kind of progress track: add, mark progress, run the clock, and roll progress. */
function TrackStep({ play, n, id, kind, title, hint, placeholder, fixedRank, extra, tables }: {
  play: Play; n: string; id: string; kind: SoloProgressTrack['kind']; title: string; hint: string; placeholder: string;
  fixedRank?: SoloProgressTrack['rank']; extra?: React.ReactNode; tables?: React.ReactNode;
}) {
  const all = play.state?.tracks ?? [];
  const tracks = all.filter(track => track.kind === kind);
  const [name, setName] = useState('');
  const [rank, setRank] = useState<SoloProgressTrack['rank']>(fixedRank ?? 'dangerous');
  const [clock, setClock] = useState(6);
  const [rolled, roll] = useRolled(play);
  const save = (next: SoloProgressTrack[]) => play.track({ tracks: next });
  const update = (trackId: string, change: (track: SoloProgressTrack) => SoloProgressTrack) => void save(all.map(track => track.id === trackId ? change(track) : track));
  const full = all.length >= SOLO_PROGRESS_LIMIT;

  async function add() {
    const track: SoloProgressTrack = { id: crypto.randomUUID(), name: name.trim(), kind, rank, ticks: 0, done: false, ...(kind === 'scene' ? { clock: { size: clock, filled: 0 } } : {}) };
    if (await save([...all, track])) setName('');
  }

  return <Step n={n} id={id} title={title} hint={hint} tables={tables}>
    {tracks.length > 0 && <ul className="solo-tracks">{tracks.map(track => {
      const score = ironProgressScore(track.ticks);
      return <li key={track.id} className={track.done ? 'is-done' : undefined}>
        <div className="solo-track-head">
          <strong>{track.name}</strong>
          <span className="solo-chip">{IRON_RANKS.find(item => item.id === track.rank)!.label}</span>
          <span className="solo-chip">Progress {score}/10</span>
        </div>
        <div className="solo-boxes" aria-label={`${track.name}: ${track.ticks} of ${IRON_TRACK_TICKS} ticks`}>
          {Array.from({ length: 10 }, (_, box) => <span key={box} className={`solo-box ticks-${Math.min(4, Math.max(0, track.ticks - box * 4))}`} />)}
        </div>
        {track.clock && <div className="solo-row solo-clock-row">
          <span className="solo-muted">Tension clock</span>
          <div className="solo-clock" aria-label={`Tension clock ${track.clock.filled} of ${track.clock.size}`}>
            {Array.from({ length: track.clock.size }, (_, segment) => <span key={segment} className={segment < track.clock!.filled ? 'is-filled' : undefined} />)}
          </div>
          <div className="solo-fear-stepper" role="group" aria-label="Tension clock">
            <button type="button" aria-label="Clear a segment" disabled={play.busy || track.clock.filled <= 0} onClick={() => update(track.id, item => ({ ...item, clock: { ...item.clock!, filled: item.clock!.filled - 1 } }))}>−</button>
            <button type="button" aria-label="Fill a segment" disabled={play.busy || track.clock.filled >= track.clock.size} onClick={() => update(track.id, item => ({ ...item, clock: { ...item.clock!, filled: item.clock!.filled + 1 } }))}>+</button>
          </div>
          {track.clock.filled >= track.clock.size && <strong className="solo-clock-full">The clock is full: Finish the Scene.</strong>}
        </div>}
        <div className="solo-actions">
          <button type="button" className="daggery-roll-toggle" disabled={play.busy || track.done || track.ticks >= IRON_TRACK_TICKS} onClick={() => update(track.id, item => ({ ...item, ticks: markIronProgress(item.ticks, item.rank) }))}><Icon name="plus" />Mark progress</button>
          <button type="button" className="daggery-primary" disabled={play.busy || track.done} onClick={() => void roll('iron-progress', { score, name: track.name })}><Icon name="dice" />Progress roll</button>
          <button type="button" className="daggery-roll-toggle" disabled={play.busy} onClick={() => update(track.id, item => ({ ...item, done: !item.done }))}><Icon name="check" />{track.done ? 'Reopen' : 'Done'}</button>
          <button type="button" className="solo-icon-button" aria-label={`Remove ${track.name}`} disabled={play.busy} onClick={() => void save(all.filter(item => item.id !== track.id))}><Icon name="trash" /></button>
        </div>
      </li>;
    })}</ul>}
    <div aria-live="polite">{rolled && <ResultCard key={rolled.id} entry={rolled} play={play} />}</div>
    <form className="solo-ask" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label className="solo-field">New {title.toLowerCase().replace(/s$/, '')}<input value={name} maxLength={120} disabled={full} onChange={change => setName(change.target.value)} placeholder={placeholder} /></label>
      {!fixedRank && <label className="solo-field">Rank<select value={rank} onChange={change => setRank(change.target.value as SoloProgressTrack['rank'])}>
        {IRON_RANKS.map(item => <option key={item.id} value={item.id}>{item.label} (Difficulty {item.difficulty}, {item.mark})</option>)}
      </select></label>}
      {kind === 'scene' && <label className="solo-field">Tension clock<select value={clock} onChange={change => setClock(Number(change.target.value))}>
        {IRON_CLOCK_SIZES.map(size => <option key={size} value={size}>{size} segments{size === 4 ? ' (disadvantage)' : size === 6 ? ' (even)' : ' (advantage)'}</option>)}
      </select></label>}
      <button className="daggery-roll-toggle" disabled={play.busy || full || !name.trim()}><Icon name="plus" />Add</button>
    </form>
    {extra}
  </Step>;
}
