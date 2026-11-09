import { useEffect, useRef, useState } from 'react';
import { getRuleset, hasFeature, resolveDuality, SOLO_EXTRA_TABLES, SOLO_LIKELIHOODS, SOLO_THEMES, type SoloActionOutcome, type SoloEntry, type SoloEntryPage, type SoloSnapshot, type SoloState, type SoloTone } from '@daggery/shared';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import { Icon } from '../../components/Icon';
import { useDoc, useDocs } from '../../sync/store';
import { useDiceTray } from '../../dice3d';
import { Rulebook } from './Rulebook';
import './solo.css';

type Tab = 'play' | 'preparation' | 'pool' | 'companions' | 'journal' | 'rules';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the action.';
const root = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/solo`;

export default function SoloPlay({ author: _author }: { author: string }) {
  if (!hasFeature(getActiveCampaign().configuration, 'daggerheart.solo') || getActiveCampaign().role !== 'gm') return <p>Solo play is not enabled for this campaign.</p>;
  return <Workspace />;
}

function Workspace() {
  const campaign = getActiveCampaign();
  const { replay } = useDiceTray();
  const resultRef = useRef<HTMLElement>(null);
  const [snapshot, setSnapshot] = useState<SoloSnapshot | null>(null);
  const [draft, setDraft] = useState<SoloState | null>(null);
  const [tab, setTab] = useState<Tab>('play');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [current, setCurrent] = useState<SoloEntry | null>(null);
  const [tone, setTone] = useState<SoloTone>('neutral');
  const [fear] = useDoc<{ value: number }>('combat', 'fear');
  const dirty = !!draft && !!snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.state);
  const companionMode = campaign.configuration.options.partyMode === 'companion';
  useEffect(() => { if (current && tab === 'play') { resultRef.current?.scrollIntoView({ block: 'start' }); resultRef.current?.focus({ preventScroll: true }); } }, [current?.id]);
  async function refresh() {
    const data = await api<SoloSnapshot>(root()); setSnapshot(data); setDraft(data.state);
    setCurrent(data.entries.find(entry => ['oracle', 'scene', 'prompt', 'response', 'table'].includes(entry.kind)) ?? null);
    setTone(data.entries.find(entry => entry.kind === 'oracle' || entry.kind === 'scene')?.result.tone ?? 'neutral');
  }
  useEffect(() => { void refresh().catch(error => setError(errorMessage(error))); }, []);
  useEffect(() => {
    const navigating = (event: Event) => { if (dirty && !window.confirm('Discard unsaved solo preparation?')) event.preventDefault(); };
    const unloading = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('daggery:before-navigate', navigating); window.addEventListener('beforeunload', unloading);
    return () => { window.removeEventListener('daggery:before-navigate', navigating); window.removeEventListener('beforeunload', unloading); };
  }, [dirty]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const replaceState = (state: SoloState) => { setDraft(state); setSnapshot(previous => previous ? { ...previous, state } : null); };
  async function save() {
    await run(async () => { const result = await api<{ state: SoloState }>(`${root()}/state`, 'PUT', draft); replaceState(result.state); setNotice('Preparation saved.'); });
  }
  async function roll(kind: string, values: Record<string, unknown>) {
    await run(async () => {
      const { entry } = await api<{ entry: SoloEntry }>(`${root()}/roll`, 'POST', { kind, requestId: crypto.randomUUID(), ...values });
      setCurrent(entry); setSnapshot(previous => previous ? { ...previous, entries: [entry, ...previous.entries] } : previous);
      if (entry.result.hope !== undefined && entry.result.fear !== undefined) void replay({ kind: 'duality', result: resolveDuality(entry.result.hope, entry.result.fear) }).catch(() => {});
      if (kind === 'oracle' || kind === 'scene') setTone(entry.result.tone);
    });
  }
  async function accept(entry: SoloEntry, interpretation: string) {
    await run(async () => {
      const result = await api<{ entry: SoloEntry }>(`${root()}/entries/${encodeURIComponent(entry.id)}`, 'PUT', { interpretation });
      setCurrent(result.entry); setSnapshot(previous => previous ? { ...previous, entries: previous.entries.map(item => item.id === entry.id ? result.entry : item) } : previous);
      setNotice('Interpretation saved to your journal.');
    });
  }
  async function command(values: Record<string, unknown>) {
    if (!draft) return;
    await run(async () => {
      const result = await api<{ state: SoloState; detail: string }>(`${root()}/command`, 'POST', { ...values, revision: draft.revision });
      replaceState(result.state); setNotice(result.detail);
      const data = await api<SoloSnapshot>(root()); setSnapshot(data); setDraft(data.state);
    });
  }
  async function older() {
    if (!snapshot?.nextCursor) return;
    await run(async () => {
      const page = await api<SoloEntryPage>(`${root()}/entries?before=${encodeURIComponent(snapshot.nextCursor!)}`);
      setSnapshot(previous => previous ? { ...previous, nextCursor: page.nextCursor, entries: [...previous.entries, ...page.entries.filter(entry => !previous.entries.some(old => old.id === entry.id))] } : previous);
    });
  }
  return <div className="solo-workspace">
    <header className="solo-heading"><div><p className="solo-kicker">{getRuleset(campaign.configuration)?.name} · {campaign.configuration.options.partyMode === 'party' ? `${campaign.configuration.options.partySize} heroes` : companionMode ? 'Hero + companion' : 'Lone hero'}</p><h1><Icon name="spark" />Solo play</h1><p>Ask, discover, act. Record what becomes true.</p></div><span className="solo-private"><Icon name="lock" />Private campaign</span></header>
    <nav className="solo-tabs" aria-label="Solo sections">{([['play', 'Oracles'], ['preparation', 'Scene'], ['pool', 'Themes & pool'], ...(companionMode ? [['companions', 'Companion']] : []), ['journal', 'Journal'], ['rules', 'Rules']] as [Tab, string][]).map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="solo-save-row"><span role="status">{dirty ? 'Unsaved preparation — save before rolling or using procedures.' : snapshot ? 'Saved to this campaign' : 'Loading campaign…'}</span>{dirty && <button className="daggery-primary" disabled={busy} onClick={() => void save()}><Icon name="check" />Save preparation</button>}<button className="daggery-roll-toggle" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard this draft and load the saved preparation?')) void run(refresh); }}>Reload saved</button></div>
    {error && <p role="alert" className="solo-alert">{error}</p>}{notice && <p role="status" className="solo-notice">{notice}</p>}
    {snapshot && draft && <>
      {tab === 'play' && <div className="solo-play-layout"><div className="solo-stack"><Oracles disabled={busy || dirty} state={snapshot.state} tone={tone} setTone={setTone} roll={roll} /><Procedures disabled={busy || dirty} state={snapshot.state} fear={fear?.value ?? 0} threshold={Number(campaign.configuration.options.fearThreshold)} command={command} /></div><section ref={resultRef} tabIndex={-1} className="solo-panel solo-result-panel"><h2>Latest result</h2>{current ? <EntryResult key={current.id} entry={current} busy={busy} accept={accept} /> : <p className="solo-empty">Roll an oracle or draw inspiration. Each result is saved; accept your interpretation to make it part of the journal.</p>}</section></div>}
      {tab === 'preparation' && <Preparation state={draft} setState={setDraft} disabled={busy} />}
      {tab === 'pool' && <ThemePool state={draft} setState={setDraft} disabled={busy} />}
      {tab === 'companions' && companionMode && <Companions state={draft} setState={setDraft} disabled={busy || dirty} editingDisabled={busy} command={command} />}
      {tab === 'journal' && <Journal entries={snapshot.entries} busy={busy} roll={roll} accept={accept} older={snapshot.nextCursor ? older : undefined} />}
      {tab === 'rules' && <Rulebook />}
    </>}
  </div>;
}

function Oracles({ state, disabled, tone, setTone, roll }: { state: SoloState; disabled: boolean; tone: SoloTone; setTone: (tone: SoloTone) => void; roll: (kind: string, values: Record<string, unknown>) => Promise<void> }) {
  const [question, setQuestion] = useState(''), [likelihood, setLikelihood] = useState('even'), [anchor, setAnchor] = useState('');
  const [table, setTable] = useState('npc');
  return <>
    <form className="solo-panel" onSubmit={event => { event.preventDefault(); void roll('oracle', { question, likelihood }); }}><h2>Ask the oracle</h2><p className="solo-muted">Unknown facts use the oracle. Risky character actions use your character sheet.</p><label className="solo-field">Your question<input required maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Is the lighthouse occupied?" /></label><label className="solo-field">Likelihood<select aria-label="Likelihood" value={likelihood} onChange={event => setLikelihood(event.target.value)}>{SOLO_LIKELIHOODS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.chance} yes</option>)}</select></label><button className="daggery-primary" disabled={disabled || !question.trim()}><Icon name="dice" />Ask with Hope & Fear</button></form>
    <section className="solo-panel"><h2>Scene & inspiration</h2><p className="solo-muted">{state.scene.title || 'Give your scene a title in the Scene tab.'}</p><p className="solo-scene-goal">{state.scene.goal || 'What do you want to accomplish here?'}</p><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void roll('scene', { question: state.scene.expected || state.scene.goal || state.scene.title })}><Icon name="compass" />Check the expected scene</button><button className="daggery-roll-toggle solo-response-button" disabled={disabled} onClick={() => void roll('response', { question: state.scene.goal })}>Inspire a world response</button><hr /><p className="solo-muted">{SOLO_THEMES.find(theme => theme.id === state.theme)?.name}{state.secondaryTheme ? ` + ${SOLO_THEMES.find(theme => theme.id === state.secondaryTheme)?.name}` : ''} · change packs in Themes & pool.</p><label className="solo-field">Pinned anchor (optional)<input value={anchor} maxLength={200} onChange={event => setAnchor(event.target.value)} placeholder="Leave empty to draw from your campaign pool" /></label><label className="solo-field">Prompt tone<select aria-label="Prompt tone" value={tone} onChange={event => setTone(event.target.value as SoloTone)}><option value="neutral">No prior tone</option><option value="hope">Hope / opportunity</option><option value="fear">Fear / obstacle</option><option value="revelation">Revelation / connection</option></select></label><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void roll('prompt', { question: state.scene.goal, anchor, tone })}><Icon name="spark" />Draw inspiration</button><p className="solo-muted solo-help">Fresh content dice select the pair. Tone carries over from your latest oracle/scene check; content doubles add no extra event.</p><details className="solo-extra-prompts"><summary>NPCs & other prompts</summary><label className="solo-field">Prompt table<select aria-label="Prompt table" value={table} onChange={event => setTable(event.target.value)}>{SOLO_EXTRA_TABLES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void roll('table', { question: state.scene.goal, table })}>Roll selected table</button></details></section>
  </>;
}

function EntryResult({ entry, busy, accept }: { entry: SoloEntry; busy: boolean; accept: (entry: SoloEntry, text: string) => Promise<void> }) {
  const [text, setText] = useState(entry.interpretation);
  return <article className={`solo-entry tone-${entry.result.tone}`}>
    <p className="solo-kicker">{entry.kind} · {new Date(entry.at).toLocaleString()} · rules {entry.rulesVersion}</p>
    {entry.question && <p className="solo-question">{entry.question}</p>}
    <div className="solo-dice-values">{entry.result.hope !== undefined && <span>Hope <strong>{entry.result.hope}</strong></span>}{entry.result.fear !== undefined && <span>Fear <strong>{entry.result.fear}</strong></span>}{entry.result.target !== undefined && <span>Total <strong>{entry.result.total}</strong> / target {entry.result.target}</span>}</div>
    {entry.result.total !== undefined && entry.result.hope === undefined && <p className="solo-muted">d12: {entry.result.total}</p>}<h3>{entry.result.title}</h3>{entry.result.anchor && <p><strong>Anchor:</strong> {entry.result.anchor}{entry.result.anchorDie ? ` · d12: ${entry.result.anchorDie}` : ''}</p>}<p className="solo-muted">{entry.result.detail}</p>
    <label className="solo-field">Your interpretation<textarea rows={4} maxLength={6000} value={text} onChange={event => setText(event.target.value)} placeholder="What happens? What can your hero respond to?" /></label><button className="daggery-primary" disabled={busy || !text.trim()} onClick={() => void accept(entry, text)}><Icon name="check" />{entry.accepted ? 'Update journal entry' : 'Accept into journal'}</button>
    <p className="solo-muted solo-help">Oracle and inspiration rolls do not change Hope, Fear, Stress, HP, or countdowns.</p>
  </article>;
}

function Preparation({ state, setState, disabled }: { state: SoloState; setState: (state: SoloState) => void; disabled: boolean }) {
  const sceneField = (key: keyof SoloState['scene'], value: string | number) => setState({ ...state, scene: { ...state.scene, [key]: value } });
  const countdown = (key: keyof SoloState['countdowns'], value: string | number) => setState({ ...state, countdowns: { ...state.countdowns, [key]: value } });
  return <fieldset disabled={disabled} className="solo-panel solo-preparation"><h2>Current scene</h2><label className="solo-field">Scene title<input maxLength={200} value={state.scene.title} onChange={event => sceneField('title', event.target.value)} /></label><label className="solo-field">Scene goal<textarea rows={3} maxLength={2000} value={state.scene.goal} onChange={event => sceneField('goal', event.target.value)} placeholder="What does your hero want here?" /></label><label className="solo-field">Expected opening<textarea rows={3} maxLength={2000} value={state.scene.expected} onChange={event => sceneField('expected', event.target.value)} placeholder="What do you expect when the scene begins?" /></label>
    <div className="solo-form-row"><label className="solo-field">Signature Fear feature / trigger<textarea rows={3} maxLength={500} value={state.scene.signature} onChange={event => sceneField('signature', event.target.value)} placeholder="Name its legal trigger before rolling" /></label><label className="solo-field">Full Fear cost<input type="number" min={1} max={12} value={state.scene.signatureCost} onChange={event => sceneField('signatureCost', Number(event.target.value))} /></label></div>
    <h2>Dynamic scene countdowns</h2><p className="solo-muted">Give a clock a name to enable it. Use these for complex goals, not damage already tracked by HP. Printed standard countdowns keep their own triggers.</p>
    {(['progress', 'consequence'] as const).map(kind => <div className="solo-clock-editor" key={kind}><label className="solo-field">{kind === 'progress' ? 'Progress event' : 'Consequence event'}<input maxLength={200} value={state.countdowns[`${kind}Name`]} onChange={event => countdown(`${kind}Name`, event.target.value)} placeholder={kind === 'progress' ? 'Find the smugglers’ exit' : 'The chamber floods'} /></label><label className="solo-field">Starting value<input aria-label={`${kind} starting value`} type="number" min={1} max={20} value={state.countdowns[`${kind}Start`]} onChange={event => { const n = Number(event.target.value); setState({ ...state, countdowns: { ...state.countdowns, [`${kind}Start`]: n, [kind]: Math.min(state.countdowns[kind], n) } }); }} /></label><label className="solo-field">Remaining<input aria-label={`${kind} remaining`} type="number" min={0} max={state.countdowns[`${kind}Start`]} value={state.countdowns[kind]} onChange={event => countdown(kind, Number(event.target.value))} /></label></div>)}
  </fieldset>;
}

function ThemePool({ state, setState, disabled }: { state: SoloState; setState: (state: SoloState) => void; disabled: boolean }) {
  const theme = SOLO_THEMES.find(item => item.id === state.theme)!;
  return <fieldset disabled={disabled} className="solo-stack"><section className="solo-panel"><h2>Scene themes</h2><div className="solo-form-row"><label className="solo-field">Primary theme<select aria-label="Primary theme" value={state.theme} onChange={event => setState({ ...state, theme: event.target.value })}>{SOLO_THEMES.map(theme => <option value={theme.id} key={theme.id}>{theme.name}</option>)}</select></label><label className="solo-field">Secondary theme<select aria-label="Secondary theme" value={state.secondaryTheme} onChange={event => setState({ ...state, secondaryTheme: event.target.value })}><option value="">Use the primary theme for both columns</option>{SOLO_THEMES.map(theme => <option value={theme.id} key={theme.id}>{theme.name}</option>)}</select></label></div><p className="solo-muted">Hope selects the primary subject; Fear selects the secondary development. Each pair uses fresh dice and keeps your established tone.</p></section>
    <section className="solo-panel"><h2>Campaign pool · 12 slots</h2><p className="solo-muted">Use named threads, NPCs, places, factions, or clues. Repeat an entry up to twice to make it recur. Empty slots mean choose a relevant existing element.</p><div className="solo-pool-grid">{state.pool.map((entry, index) => <label className="solo-field solo-pool-slot" key={index}><span>{index + 1}</span><input aria-label={`Pool slot ${index + 1}`} maxLength={200} value={entry} onChange={event => setState({ ...state, pool: state.pool.map((old, slot) => slot === index ? event.target.value : old) })} placeholder="A thread, person, place, or clue" /></label>)}</div></section>
    <section className="solo-panel"><h2>{theme.name} reference</h2><div className="solo-reference-table"><table><thead><tr><th>d12</th><th>Subject</th><th>Development</th></tr></thead><tbody>{theme.subjects.map((subject, index) => <tr key={subject}><td>{index + 1}</td><td>{subject}</td><td>{SOLO_THEMES.find(item => item.id === (state.secondaryTheme || state.theme))!.developments[index]}</td></tr>)}</tbody></table></div></section>
  </fieldset>;
}

function Procedures({ state, disabled, fear, threshold, command }: { state: SoloState; disabled: boolean; fear: number; threshold: number; command: (input: Record<string, unknown>) => Promise<void> }) {
  const [outcome, setOutcome] = useState<SoloActionOutcome>('success-hope'), [confirmed, setConfirmed] = useState(false);
  const amount = state.scene.signature ? state.scene.signatureCost : 1;
  return <section className="solo-panel"><header className="solo-section-heading"><h2>World response</h2><span className="solo-fear">Fear {fear} / 12</span></header><p className="solo-muted">Resolve your hero’s action on the character sheet. One failure with Fear creates one response. Use the Rules tab for the full procedure.</p><div className="solo-form-row"><label className="solo-field">Action outcome<select aria-label="Action outcome" value={outcome} onChange={event => setOutcome(event.target.value as SoloActionOutcome)}><option value="critical">Critical success</option><option value="success-hope">Success with Hope</option><option value="success-fear">Success with Fear</option><option value="failure-hope">Failure with Hope</option><option value="failure-fear">Failure with Fear</option></select></label><button className="daggery-roll-toggle" disabled={disabled || state.beat.outcomeApplied || !state.countdowns.progressName && !state.countdowns.consequenceName} onClick={() => void command({ command: 'countdown', outcome })}>Apply to countdowns</button></div>
    <div className="solo-clock-readout">{(['progress', 'consequence'] as const).map(kind => state.countdowns[`${kind}Name`] && <span key={kind}>{state.countdowns[`${kind}Name`]} <strong>{state.countdowns[kind]}</strong>{state.countdowns[kind] === 0 ? ' · resolve the event' : ` / ${state.countdowns[`${kind}Start`]}`}</span>)}</div>
    <p className="solo-muted">{state.scene.signature || 'No signature chosen. The default paid move is a warning or repositioning setup without immediate damage or clock ticks.'} · {amount} Fear</p><label className="solo-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />The trigger, positioning, and full cost are valid.</label><button className="daggery-roll-toggle" disabled={disabled || !confirmed || state.beat.fearSpent || fear < threshold || fear < amount} onClick={() => { setConfirmed(false); void command({ command: 'spend-fear', amount }); }}>Spend {amount} Fear{state.beat.fearSpent ? ' · already used this beat' : ''}</button><p className="solo-muted solo-help">Pacing activates at {threshold} Fear. Resolve the chosen feature or setup yourself; no damage is applied automatically.</p><hr /><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void command({ command: 'next-beat' })}><Icon name="arrow" />Begin next character action</button><p className="solo-muted solo-help">Start one beat per character action, before companion assistance. Oracle questions never reset the beat.</p>
  </section>;
}

function Companions({ state, setState, disabled, editingDisabled, command }: { state: SoloState; setState: (state: SoloState) => void; disabled: boolean; editingDisabled: boolean; command: (input: Record<string, unknown>) => Promise<void> }) {
  const { items: heroes } = useDocs<{ name: string; hope: number }>('sheets');
  const [heroId, setHeroId] = useState('');
  const selectedHero = heroId || Object.keys(heroes)[0] || '';
  const companion = state.companions[0];
  const [confirmed, setConfirmed] = useState(false);
  if (!companion) return <section className="solo-panel"><h2>Your companion</h2><p className="solo-muted">A supporting character with three HP and three Stress. Save the profile before using contributions.</p><button className="daggery-primary" disabled={editingDisabled} onClick={() => setState({ ...state, companions: [{ id: crypto.randomUUID(), name: '', motive: '', bond: '', specialty: '', tier: 1, hpMarked: 0, stressMarked: 0 }] })}><Icon name="plus" />Create companion</button></section>;
  const update = (key: string, value: string | number) => setState({ ...state, companions: [{ ...companion, [key]: value }] });
  const exhausted = companion.hpMarked >= 3 || companion.stressMarked >= 3 || state.beat.contributions.includes(companion.id);
  return <div className="solo-play-layout"><fieldset className="solo-panel" disabled={editingDisabled}><h2>Companion profile</h2>{([['name', 'Name', 100], ['specialty', 'Specialty', 200], ['motive', 'Motive', 500], ['bond', 'Bond', 500]] as const).map(([key, label, maxLength]) => <label className="solo-field" key={key}>{label}<input maxLength={maxLength} value={companion[key]} onChange={event => update(key, event.target.value)} /></label>)}<label className="solo-field">Hero’s tier<select aria-label="Hero’s tier" value={companion.tier} onChange={event => update('tier', Number(event.target.value))}>{[1, 2, 3, 4].map(tier => <option key={tier} value={tier}>Tier {tier}</option>)}</select></label><p className="solo-stats">Evasion <strong>{10 + companion.tier}</strong> · thresholds <strong>{6 + 3 * companion.tier} / {12 + 3 * companion.tier}</strong> · no Armor Slots</p><div className="solo-form-row">{(['hpMarked', 'stressMarked'] as const).map(key => <label className="solo-field" key={key}>{key === 'hpMarked' ? 'HP marked' : 'Stress marked'}<select aria-label={key === 'hpMarked' ? 'Companion HP marked' : 'Companion Stress marked'} value={companion[key]} onChange={event => update(key, Number(event.target.value))}>{[0, 1, 2, 3].map(n => <option key={n} value={n}>{n} / 3</option>)}</select></label>)}</div></fieldset><section className="solo-panel"><h2>One contribution per beat</h2><p className="solo-muted">Each contribution marks 1 companion Stress. At 3 Stress the companion is Vulnerable and cannot contribute; at 3 HP they are incapacitated.</p><label className="solo-field">Hero to assist<select aria-label="Hero to assist" value={selectedHero} onChange={event => setHeroId(event.target.value)}>{Object.entries(heroes).map(([id, hero]) => <option value={id} key={id}>{hero.name} · {hero.hope} Hope</option>)}{!Object.keys(heroes).length && <option value="">Create your hero in Characters first</option>}</select></label><label className="solo-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Positioning is valid. Assist will pay 1 hero Hope and apply advantage on the next character-sheet action.</label><div className="solo-contributions">{([['assist', 'Assist', 'Pay 1 hero Hope and prepare advantage for the next eligible action.'], ['strike', 'Strike together', 'Roll a bonus d6 for a successful attack’s damage.'], ['cover', 'Cover', 'Reduce the HP the hero would mark by 1; excludes direct damage.']] as const).map(([id, name, detail]) => <button key={id} className="solo-contribution" disabled={disabled || exhausted || !confirmed || id === 'assist' && (!selectedHero || (heroes[selectedHero]?.hope ?? 0) < 1)} onClick={() => { setConfirmed(false); void command({ command: 'companion', companionId: companion.id, contribution: id, heroId: selectedHero, confirmed: true }); }}><strong>{name}</strong><span>{detail}</span></button>)}</div><hr /><h3>After the hero’s completed rest</h3><p className="solo-muted">Use once after that rest; the hero’s sheet handles its recovery and normal Fear gain.</p><div className="solo-form-row"><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void command({ command: 'rest-companion', companionId: companion.id, rest: 'short' })}>Short-rest recovery</button><button className="daggery-roll-toggle" disabled={disabled} onClick={() => void command({ command: 'rest-companion', companionId: companion.id, rest: 'long' })}>Long-rest recovery</button></div></section></div>;
}

function Journal({ entries, busy, roll, accept, older }: { older?: () => Promise<void>; entries: SoloEntry[]; busy: boolean; roll: (kind: string, values: Record<string, unknown>) => Promise<void>; accept: (entry: SoloEntry, text: string) => Promise<void> }) {
  const [note, setNote] = useState(''), [filter, setFilter] = useState('accepted');
  const shown = entries.filter(entry => filter === 'all' || entry.accepted);
  return <div className="solo-stack"><form className="solo-panel" onSubmit={event => { event.preventDefault(); void roll('journal', { question: note }); }}><h2>Session journal</h2><label className="solo-field">Add a note<textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="What changed? What will you do next?" /></label><button className="daggery-primary" disabled={busy || !note.trim()}>Save journal note</button></form><label className="solo-field solo-journal-filter">Show<select aria-label="Journal filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="accepted">Accepted facts & notes</option><option value="all">All results</option></select></label>{shown.length === 0 && <p className="solo-empty">Your accepted interpretations and session notes appear here.</p>}{shown.map(entry => <details className="solo-panel solo-journal-entry" key={entry.id}><summary><span>{entry.question || entry.result.title}</span><small>{entry.kind} · {new Date(entry.at).toLocaleDateString()}{entry.accepted ? ' · accepted' : ' · not interpreted'}</small></summary>{entry.interpretation && <p className="solo-interpretation">{entry.interpretation}</p>}<EntryResult entry={entry} busy={busy} accept={accept} /></details>)}{older && <button className="daggery-roll-toggle" disabled={busy} onClick={() => void older()}>Load older entries</button>}<p className="solo-muted">{entries.length} saved results loaded.</p></div>;
}
