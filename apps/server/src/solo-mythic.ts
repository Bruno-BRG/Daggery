import {
  advanceThreadTrack, discoveryOdds, eventFocusById, fateAnswerGuide, fateEventGuide, FOUR_W, isChaosFlavor, listSectionDie,
  MYTHIC_ANSWER_LABELS, MYTHIC_CHAOS_FLAVORS, MYTHIC_MEANING_CHOICES, MYTHIC_ODDS, MYTHIC_QUESTION_PURPOSES, mythicOddsIndex,
  resolveEventFocus, resolveFateChart, resolveFateCheck, resolveListRoll, resolveSceneAdjustments, resolveSceneTest,
  resolveThreadDiscovery, rollDie,
  type FateResult, type MythicAnswer, type MythicChaosFlavor, type MythicData, type MythicList, type MythicQuestionPurpose,
  type MythicTable, type Rng, type SoloResult, type SoloState, type SoloTone, type SoloTrackerItem,
} from '@daggery/shared';

export interface MythicRoll {
  state: SoloState;
  data: MythicData;
  rng: Rng;
  input: Record<string, unknown>;
  question: string;
}
/** `changed` means the roll also moved the solo state (a thread track, usually) and it must be saved. */
export interface MythicOutcome { result: SoloResult; question?: string; changed?: boolean }

const TONES: Record<MythicAnswer, SoloTone> = { exceptionalYes: 'revelation', yes: 'hope', no: 'fear', exceptionalNo: 'fear' };
const LIST_LABELS: Record<MythicList, string> = { threads: 'Threads List', characters: 'Characters List', features: 'Adventure Features List' };

const text = (value: unknown, max: number, fallback?: string): string => {
  if (value === undefined || value === null) { if (fallback !== undefined) return fallback; throw new Error('Invalid solo text'); }
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid solo text');
  return value;
};
const chaosOf = (state: SoloState) => state.chaos ?? 5;
const flavorOf = (state: SoloState): MythicChaosFlavor => (isChaosFlavor(state.chaosFlavor) ? state.chaosFlavor : 'standard');
/** Lines of a List: its open elements, in order. Closed elements are crossed off. */
export const openLines = (state: SoloState, list: MythicList): SoloTrackerItem[] => (state[list] ?? []).filter(item => !item.done);
const lineCounts = (state: SoloState): Record<MythicList, number> => ({
  threads: openLines(state, 'threads').length, characters: openLines(state, 'characters').length, features: openLines(state, 'features').length,
});

function findTable(data: MythicData, id: string): MythicTable | undefined {
  for (const file of [data.collectedTables, data.oracle, data.adventureCrafter, data.locationCrafting]) {
    const table = file?.tables.find(item => item.id === id);
    if (table) return table;
  }
  return undefined;
}
function rollEntry(table: MythicTable, rng: Rng, column = 0): { roll: number; word: string } {
  const sides = Number(/^d(\d+)$/i.exec(table.die)?.[1]);
  if (!sides) throw new Error('Invalid Mythic table die');
  const roll = rollDie(sides, rng);
  const entry = table.entries.find(item => item.range && roll >= item.range[0] && roll <= item.range[1]);
  const word = (entry?.cells ? entry.cells[column] : entry?.text) ?? entry?.text ?? '';
  if (!word.trim()) throw new Error('Invalid Mythic table entry');
  return { roll, word };
}

/**
 * Rolls inspiration words. Actions, Descriptions and the Elements tables give
 * a word pair; the One-Page columns give one word at a time.
 */
export function rollMeaning(data: MythicData, rng: Rng, choiceId: string): { label: string; words: string[]; rolls: number[] } {
  const onePage = findTable(data, 'discover-meaning');
  if (choiceId === 'one-page-action' || choiceId === 'one-page-description') {
    if (!onePage) throw new Error('Invalid meaning table: the One-Page Discover Meaning table is not installed');
    const { roll, word } = rollEntry(onePage, rng, choiceId === 'one-page-action' ? 0 : 1);
    return { label: `Discover Meaning, ${choiceId === 'one-page-action' ? 'Action' : 'Description'}`, words: [word], rolls: [roll] };
  }
  const choice = MYTHIC_MEANING_CHOICES.find(item => item.id === choiceId);
  if (!choice) throw new Error('Invalid meaning table');
  const tables = choice.tables.map(id => findTable(data, id));
  if (tables[0] && tables[1]) {
    const first = rollEntry(tables[0], rng), second = rollEntry(tables[1], rng);
    return { label: choice.label, words: [first.word, second.word], rolls: [first.roll, second.roll] };
  }
  // With only the One-Page table installed, its two columns stand in for Actions and Descriptions.
  if (choice.group === 'core' && onePage) {
    const column = choice.id === 'actions' ? 0 : 1;
    const first = rollEntry(onePage, rng, column), second = rollEntry(onePage, rng, column);
    return { label: `${choice.label} (One-Page table)`, words: [first.word, second.word], rolls: [first.roll, second.roll] };
  }
  throw new Error(`Invalid meaning table: “${choice.label}” is not installed`);
}
const meaningLine = (data: MythicData, rng: Rng, choiceId: string) => {
  const meaning = rollMeaning(data, rng, choiceId);
  return { meaning, line: `Meaning (${meaning.label}) d100 ${meaning.rolls.join(', ')}: ${meaning.words.join(' / ')}` };
};

/** Rolls for one line of a List and says what was invoked. */
function rollList(state: SoloState, list: MythicList, rng: Rng, full = false): { line: string; name: string | null } {
  const lines = openLines(state, list);
  const die = listSectionDie(lines.length, full);
  const sectionRoll = die ? rollDie(die, rng) : undefined;
  const lineRoll = rollDie(10, rng);
  const picked = resolveListRoll(lines.length, lineRoll, sectionRoll, full);
  const dice = `${die ? `d${die} ${sectionRoll}, ` : ''}d10 ${lineRoll}`;
  if (picked.index === null) {
    return { name: null, line: `${LIST_LABELS[list]} ${dice}: line ${picked.line} is empty. Choose any element on the List, or roll again.${full ? ' You may also add a new Thread or NPC, or choose your own character.' : ''}` };
  }
  const name = lines[picked.index]!.name;
  return { name, line: `${LIST_LABELS[list]} ${dice}: line ${picked.line}, ${name}` };
}

/**
 * Generates a Random Event: the Event Focus (rolled, or chosen), the List
 * element it invokes, and a Meaning word pair. One-Page Mythic has no focus:
 * a single Discover Meaning word read against the current context.
 */
export function randomEvent(roll: MythicRoll, options: { focus?: string; meaning?: string } = {}): { title: string; lines: string[] } {
  const { state, data, rng } = roll;
  if (flavorOf(state) === 'one-page' && !options.focus) {
    const { meaning, line } = meaningLine(data, rng, options.meaning ?? 'one-page-action');
    return { title: meaning.words.join(' / '), lines: [line, 'Read it as an event in the current context. Not enough? Roll another word.'] };
  }
  const prepared = !!state.preparedAdventure;
  const lines: string[] = [];
  let focus;
  if (options.focus) {
    focus = eventFocusById(options.focus, prepared);
    if (focus.list && lineCounts(state)[focus.list] === 0) throw new Error(`Invalid event focus: the ${LIST_LABELS[focus.list]} is empty`);
    lines.push(`Event Focus (chosen): ${focus.label}`);
  } else {
    const focusRoll = rollDie(100, rng);
    const resolved = resolveEventFocus(focusRoll, lineCounts(state), prepared);
    focus = resolved.focus;
    lines.push(resolved.replaced
      ? `Event Focus d100 ${focusRoll}: ${resolved.rolled.label}, but the ${LIST_LABELS[resolved.rolled.list!]} is empty, so Current Context`
      : `Event Focus d100 ${focusRoll}: ${focus.label}`);
  }
  lines.push(focus.hint);
  if (focus.list) {
    const picked = rollList(state, focus.list, rng);
    lines.push(picked.line);
    const track = state.threadTrack;
    if (focus.id === 'close-thread' && track && !track.concluded && picked.name === track.name) {
      lines.push('Plot Armor: this is the Focus Thread of the Progress Track. The event may look like it closes the thread, but it does not.');
    }
  }
  lines.push(meaningLine(data, rng, options.meaning ?? 'actions').line);
  return { title: focus.label, lines };
}

function askFate(roll: MythicRoll, odds: string, purpose: MythicQuestionPurpose | 'discovery', method: string): { fate: FateResult; lines: string[] } {
  const { state, rng } = roll;
  // A Fate Question standing in for a rule of the game ignores the current chaos.
  const chaos = purpose === 'rpg-rule' ? 5 : chaosOf(state);
  const flavor = flavorOf(state);
  const label = MYTHIC_ODDS[mythicOddsIndex(odds)]!.label;
  const flavorNote = flavor === 'standard' ? '' : ` (${MYTHIC_CHAOS_FLAVORS.find(item => item.id === flavor)!.label})`;
  const chaosNote = flavor === 'one-page' ? flavorNote.trim() : `Chaos ${chaos}${flavorNote}`;
  let fate: FateResult, first: string;
  if (method === 'check') {
    const a = rollDie(10, rng), b = rollDie(10, rng);
    fate = resolveFateCheck(a, b, odds, chaos, flavor);
    const modifier = fate.modifier!;
    first = `2d10: ${a} + ${b}${modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : ''} = ${fate.total} · Odds: ${label} · ${chaosNote}`;
  } else if (method === 'chart') {
    const d100 = rollDie(100, rng);
    fate = resolveFateChart(d100, odds, chaos, flavor);
    fate.total = d100;
    first = `d100: ${d100} · Odds: ${label} · ${chaosNote}`;
  } else throw new Error('Invalid Fate Question method');
  return { fate, lines: [first, fateAnswerGuide(purpose, fate.answer)] };
}

export function rollMythic(kind: string, roll: MythicRoll): MythicOutcome {
  const { state, data, rng, input } = roll;
  const question = roll.question.trim();

  if (kind === 'mythic-oracle') {
    if (!question) throw new Error('Invalid question');
    const purpose = text(input.purpose, 30, 'question') as MythicQuestionPurpose;
    if (!MYTHIC_QUESTION_PURPOSES.some(item => item.id === purpose)) throw new Error('Invalid Fate Question purpose');
    const { fate, lines } = askFate(roll, text(input.odds, 80), purpose, text(input.method, 10, 'chart'));
    if (fate.randomEvent) {
      lines.push(`Random Event: ${fateEventGuide(purpose)}`);
      if (purpose === 'npc-behavior') lines.push(meaningLine(data, rng, 'actions').line);
      else if (purpose !== 'rpg-rule') lines.push(...randomEvent(roll).lines);
    }
    return { result: { title: MYTHIC_ANSWER_LABELS[fate.answer], detail: lines.join('\n'), tone: TONES[fate.answer], total: fate.total } };
  }

  if (kind === 'mythic-event') {
    const reason = text(input.reason, 20, '');
    const meaning = input.meaning === undefined ? undefined : text(input.meaning, 80);
    if (reason === 'flashpoint' || reason === 'conclusion') {
      const track = state.threadTrack;
      if (!track) throw new Error('Invalid event: no Thread Progress Track is running');
      if (reason === 'conclusion' && !track.concluded) throw new Error('Invalid event: the Progress Track is not complete');
      const event = randomEvent(roll, { focus: 'current-context', meaning });
      const lead = reason === 'flashpoint'
        ? `Flashpoint for “${track.name}”: a dramatic, important event involving the Focus Thread that does not resolve it.`
        : `Conclusion for “${track.name}”: an event that can resolve and end the Focus Thread.`;
      if (reason === 'flashpoint') track.pendingFlashpoints = Math.max(0, track.pendingFlashpoints - 1);
      return { question: question || track.name, changed: reason === 'flashpoint', result: { title: reason === 'flashpoint' ? 'Flashpoint' : 'Conclusion', detail: [lead, ...event.lines].join('\n'), tone: 'revelation' } };
    }
    const event = randomEvent(roll, { focus: input.focus === undefined || input.focus === '' ? undefined : text(input.focus, 40), meaning });
    return { question: question || 'Random Event', result: { title: event.title, detail: event.lines.join('\n'), tone: 'revelation' } };
  }

  if (kind === 'mythic-scene') {
    const chaos = chaosOf(state);
    const lines: string[] = [];
    let outcome: 'expected' | 'altered' | 'interrupt', total: number | undefined;
    if (input.auto === 'interrupt') {
      outcome = 'interrupt';
      lines.push('Automatic Interrupt: no test against the Chaos Factor.');
    } else {
      total = rollDie(10, rng);
      outcome = resolveSceneTest(total, chaos);
      lines.push(`d10: ${total} · Chaos ${chaos}`);
    }
    let title = 'Expected scene', tone: SoloTone = 'neutral';
    if (outcome === 'expected') lines.push('The scene begins as you expected.');
    else if (state.preparedAdventure) {
      title = 'Expected scene with a Random Event'; tone = 'revelation';
      lines.push('Prepared adventure: the scene begins as expected, and it starts with a Random Event.', ...randomEvent(roll).lines);
    } else if (outcome === 'altered') {
      title = 'Altered scene'; tone = 'fear';
      lines.push('The scene is not what you expected. By default it is the next thing you would most expect. You can also change one element, ask a Fate Question, roll a Meaning pair, or roll the Scene Adjustment Table.');
    } else {
      title = 'Interrupt scene'; tone = 'revelation';
      lines.push('Something else happens instead of the scene you expected. This Random Event is how it starts.', ...randomEvent(roll).lines);
    }
    for (const keyed of state.keyedScenes ?? []) if (keyed.triggered && !keyed.done) lines.push(`Keyed Scene due now: ${keyed.event}`);
    const pending = state.threadTrack?.pendingFlashpoints ?? 0;
    if (pending > 0) lines.push(`A Flashpoint for “${state.threadTrack!.name}” happens in this scene. Generate it from the Thread Progress Track.`);
    return { question: question || state.scene.title || 'Scene test', result: { title, detail: lines.join('\n'), tone, total } };
  }

  if (kind === 'mythic-adjust') {
    const rolls = [rollDie(10, rng)];
    if (rolls[0]! >= 7) for (let found = 0; found < 2;) { const next = rollDie(10, rng); rolls.push(next); if (next < 7) found++; }
    const { adjustments } = resolveSceneAdjustments(rolls);
    return { question: question || 'Scene adjustment', result: { title: adjustments.join(' + '), detail: `Scene Adjustment d10: ${rolls.join(', ')}${rolls[0]! >= 7 ? ' · two adjustments' : ''}\nChange the Expected Scene this way.`, tone: 'neutral', total: rolls[0] } };
  }

  if (kind === 'mythic-meaning') {
    const count = typeof input.count === 'number' && Number.isInteger(input.count) && input.count >= 1 && input.count <= 4 ? input.count : 1;
    const choice = text(input.choice, 80, 'actions');
    const rolled = Array.from({ length: count }, () => meaningLine(data, rng, choice));
    return { question: question || rolled[0]!.meaning.label, result: { title: count === 1 ? rolled[0]!.meaning.words.join(' / ') : 'Discover Meaning', detail: rolled.map(item => item.line).join('\n'), tone: 'neutral', total: rolled[0]!.meaning.rolls[0] } };
  }

  if (kind === 'mythic-four-w') {
    const lines = FOUR_W.map(item => `${item.label}: ${meaningLine(data, rng, item.choice).line}`);
    return { question: question || 'First scene', result: { title: 'Who, what, where, why', detail: lines.join('\n'), tone: 'neutral' } };
  }

  if (kind === 'mythic-list') {
    const list = text(input.list, 20) as MythicList;
    if (!(list in LIST_LABELS)) throw new Error('Invalid list');
    const picked = rollList(state, list, rng, input.full === true);
    return { question: question || LIST_LABELS[list], result: { title: picked.name ?? 'Choose', detail: picked.line, tone: 'neutral' } };
  }

  if (kind === 'mythic-discovery') {
    const track = state.threadTrack;
    if (!track || track.concluded) throw new Error('Invalid Discovery Check: start a Thread Progress Track first');
    if (track.discoveryBlocked) throw new Error('Invalid Discovery Check: a dead end. Try again in another scene');
    const odds = discoveryOdds(text(input.odds, 80, 'fifty-fifty'));
    const { fate, lines } = askFate(roll, odds, 'discovery', text(input.method, 10, 'chart'));
    const checks = fate.answer === 'exceptionalYes' ? 2 : fate.answer === 'yes' ? 1 : 0;
    const progress = track.points;
    let current = track, triggered = 0;
    for (let index = 0; index < checks; index++) {
      const d10 = rollDie(10, rng);
      const found = resolveThreadDiscovery(d10, progress);
      lines.push(`Thread Discovery d10 ${d10} + ${progress} = ${found.total}: ${found.label}. ${found.hint}`, meaningLine(data, rng, text(input.meaning, 80, 'actions')).line);
      const advanced = advanceThreadTrack(current, found.points, found.flashpoint);
      current = advanced.track; triggered += advanced.triggered;
    }
    if (fate.answer === 'exceptionalNo') current = { ...current, discoveryBlocked: true };
    if (checks) lines.push(`Progress Track: ${current.points} of ${current.length}.`);
    if (triggered) lines.push('The phase ended with no Flashpoint, so the Track triggers one. Generate it from the Thread Progress Track.');
    if (current.concluded) lines.push('The Track is complete. Generate the Conclusion from the Thread Progress Track.');
    if (fate.randomEvent) lines.push(`Random Event: ${fateEventGuide('discovery')}`, ...randomEvent(roll).lines);
    state.threadTrack = current;
    return { question: question || `Is something discovered? (${track.name})`, changed: checks > 0 || fate.answer === 'exceptionalNo', result: { title: `Discovery: ${MYTHIC_ANSWER_LABELS[fate.answer]}`, detail: lines.join('\n'), tone: TONES[fate.answer], total: fate.total } };
  }

  if (kind === 'mythic-turning-point') {
    const themes = findTable(data, 'adventure-themes'), points = findTable(data, 'plot-points');
    if (!themes || !points?.columns) throw new Error('Invalid Turning Point: the Adventure Crafter tables are not installed');
    const chosen = text(input.theme, 40, state.adventureTheme ?? '');
    if (chosen && !points.columns.includes(chosen)) throw new Error('Invalid adventure theme');
    const lines: string[] = [];
    for (let index = 0; index < 5; index++) {
      let theme = chosen, themeNote = 'adventure theme';
      if (index > 0 || !theme) { const rolled = rollEntry(themes, rng); theme = rolled.word; themeNote = `d10 ${rolled.roll}`; }
      const point = rollEntry(points, rng, points.columns.indexOf(theme));
      lines.push(`${index + 1}. ${theme} (${themeNote}) · d100 ${point.roll}: ${point.word}`);
    }
    lines.push('Read the five Plot Points together as one Turning Point. Conclusion wraps up a storyline; if that makes no sense yet, treat it as None. None adds nothing.');
    return { question: question || 'Turning Point', result: { title: 'Turning Point', detail: lines.join('\n'), tone: 'revelation' } };
  }

  throw new Error('Invalid solo roll type');
}
