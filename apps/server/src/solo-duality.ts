import { adversaries } from '@daggery/content';
import {
  adversaryTypeName, DUALITY_LIKELIHOODS, DUALITY_MEANING_CHOICES, dualityAnswerLabel, dualityTable, eventFocusList, fearCheck, readDualityMeaning,
  readDualityTable, resolveDualityMove, resolveDualityOracle, resolveDualityScene, resolveFearSpend, rollDie,
  type DualityList, type DualityMeaningTable, type Rng, type SoloResult, type SoloState, type SoloTone, type SoloTrackerItem,
} from '@daggery/shared';

export interface DualityRoll {
  state: SoloState;
  /** Fear in the campaign pool when the roll starts. */
  fear: number;
  rng: Rng;
  input: Record<string, unknown>;
  question: string;
  /** When true, a Fear cost is reported as a suggestion and the caller never writes the pool. */
  advisory?: boolean;
}
/** `fearSpent` is Fear the engine took from the pool; the caller saves the new value. */
export interface DualityOutcome { result: SoloResult; question?: string; fearSpent: number }

const LIST_LABELS: Record<DualityList, string> = { threads: 'Threads', characters: 'NPCs' };
const text = (value: unknown, max: number, fallback?: string): string => {
  if (value === undefined || value === null) { if (fallback !== undefined) return fallback; throw new Error('Invalid solo text'); }
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid solo text');
  return value;
};
/** Lines of a List: its open elements, in order. Closed elements are crossed off. */
export const openLines = (state: SoloState, list: DualityList): SoloTrackerItem[] => (state[list] ?? []).filter(item => !item.done);

/** Rolls, remembers how much Fear is left, and collects the lines of one result. */
class Table {
  lines: string[] = [];
  /** Cells the roll landed on, so the screen can mark the rows. */
  cells: NonNullable<SoloResult['cells']> = [];
  spent = 0;
  constructor(private roll: DualityRoll) {}
  get fear() { return this.roll.fear - this.spent; }
  d12() { return rollDie(12, this.roll.rng); }
  /** Spends Fear if the pool has it. Returns whether it was paid. */
  spend(amount = 1): boolean {
    if (this.fear < amount) return false;
    this.spent += amount;
    return true;
  }
  /** A Fear Check, written to the lines. */
  check(): { roll: number; passed: boolean } {
    const roll = this.d12(), passed = fearCheck(roll, this.fear);
    this.lines.push(`Fear Check d12 ${roll} vs Fear ${this.fear}: ${passed ? 'passes' : 'fails'}`);
    return { roll, passed };
  }
  /** One d12 on one column of a table, written to the lines. */
  row(tableId: string, column = 0): { roll: number; value: string } {
    const roll = this.d12(), value = readDualityTable(tableId, roll, column);
    this.cells.push({ table: tableId, column, roll });
    this.lines.push(`${dualityTable(tableId).columns[column]!.label} d12 ${roll}: ${value}`);
    return { roll, value };
  }
  meaning(tables: readonly DualityMeaningTable[]): string {
    const words = tables.map(id => {
      const hope = this.d12(), fear = this.d12();
      this.cells.push({ table: id, column: fear % 2 === 1 ? 0 : 1, roll: hope });
      return { word: readDualityMeaning(id, hope, fear), dice: `${hope}/${fear}` };
    });
    const phrase = words.map(item => item.word).join(' / ');
    this.lines.push(`Meaning (Hope/Fear ${words.map(item => item.dice).join(', ')}): ${phrase}`);
    return phrase;
  }
  /** A full name: the Hope die picks the given-name row, the Fear die its column (odd A, even B). */
  name(): string {
    const hope = this.d12(), fear = this.d12(), column = fear % 2 === 1 ? 0 : 1;
    const given = readDualityTable('names', hope, column);
    this.cells.push({ table: 'names', column, roll: hope });
    this.lines.push(`Given name (Hope/Fear ${hope}/${fear}): ${given}`);
    const family = this.row('names', 2), epithet = this.row('names', 3);
    return `${given} ${family.value}, ${epithet.value}`;
  }
  /** A place name from one First and one Second part, such as Ashford. */
  placeName(): string {
    const first = this.row('place-name', 0), second = this.row('place-name', 1);
    return `${first.value}${second.value.replace(/^-/, '')}`;
  }
  /** Picks an open line of a List with a d12, rerolling blanks. */
  list(list: DualityList): string | null {
    const lines = openLines(this.roll.state, list);
    if (lines.length === 0) { this.lines.push(`${LIST_LABELS[list]} list is empty: invent one, or read the event against the current scene.`); return null; }
    let roll = this.d12();
    for (let tries = 0; roll > lines.length && tries < 200; tries++) roll = this.d12();
    const picked = lines[Math.min(roll, lines.length) - 1]!;
    this.lines.push(`${LIST_LABELS[list]} d12 ${roll}: ${picked.name}`);
    return picked.name;
  }
  /** Event Focus, the List line it invokes, and an Action + Subject pair. */
  randomEvent(focusRoll?: number): string {
    const roll = focusRoll ?? this.d12();
    const focus = readDualityTable('event-focus', roll);
    this.cells.push({ table: 'event-focus', column: 0, roll });
    this.lines.push(`Event Focus ${focusRoll ? '(chosen)' : `d12 ${roll}`}: ${focus}`);
    const list = eventFocusList(roll);
    if (list) this.list(list);
    this.meaning(['action', 'subject']);
    return focus;
  }
  /** A Hard Move already paid for. A 12 spends 1 more Fear, if able, for two moves. */
  hardMove(): string {
    const first = this.row('hard-move');
    if (first.roll !== 12) return first.value;
    if (!this.spend()) { this.lines.push('No Fear left for a second move: roll again for one move.'); return this.rerollHard(); }
    this.lines.push('1 more Fear spent: two Hard Moves, both happen.');
    return `${this.rerollHard()} + ${this.rerollHard()}`;
  }
  private rerollHard(): string {
    let roll = this.d12();
    for (let tries = 0; roll === 12 && tries < 200; tries++) roll = this.d12();
    const value = readDualityTable('hard-move', Math.min(roll, 11));
    this.cells.push({ table: 'hard-move', column: 0, roll: Math.min(roll, 11) });
    this.lines.push(`Hard Move d12 ${roll}: ${value}`);
    return value;
  }
  softMove(): string {
    const move = this.row('soft-move');
    if (move.roll === 12) return this.row('scene-complication').value;
    return move.value;
  }
  done(title: string, tone: SoloTone, extra: Partial<SoloResult> = {}, question?: string): DualityOutcome {
    if (this.spent) this.lines.push(this.roll.advisory
      ? `Suggested Fear cost: ${this.spent} (Fear pool ${this.roll.fear}). Pay it with spend_fear only if you use this move.`
      : `Fear spent: ${this.spent} (${this.fear} left).`);
    const cells = this.cells.length ? { cells: this.cells } : {};
    return { result: { title, detail: this.lines.join('\n'), tone, ...cells, ...extra }, question, fearSpent: this.spent };
  }
}

export function rollDuality(kind: string, roll: DualityRoll): DualityOutcome {
  const { state, input } = roll;
  const question = roll.question.trim();
  const t = new Table(roll);

  if (kind === 'duality-oracle') {
    // The table's own oracle may go unspoken (the player keeps it in a notebook); the AI GM must say what it asks.
    if (!question && roll.advisory) throw new Error('Invalid question');
    const hope = t.d12(), fear = t.d12();
    const answer = resolveDualityOracle(hope, fear, text(input.likelihood, 30));
    const band = DUALITY_LIKELIHOODS.find(item => item.target === answer.target)!;
    t.lines.push(`Hope ${hope} + Fear ${fear} = ${answer.total} · ${band.label} needs ${band.target}+`);
    if (answer.twist === 'favor') t.lines.push('Twist (Hope higher by 4 or more): it bends your way.');
    if (answer.twist === 'against') t.lines.push('Twist (Fear higher by 4 or more): it bends against you.');
    if (answer.randomEvent) { t.lines.push('Doubles: a Random Event occurs as well.'); t.randomEvent(); }
    const tone: SoloTone = answer.randomEvent ? 'revelation' : answer.twist === 'against' ? 'fear' : answer.twist === 'favor' ? 'hope' : 'neutral';
    return t.done(dualityAnswerLabel(answer), tone, { hope, fear, total: answer.total, target: answer.target }, question || 'Oracle');
  }

  if (kind === 'duality-fear-check') {
    const check = t.check();
    t.lines.push(check.passed ? 'The GM acts. Spend Fear for what it does.' : 'The world holds its breath.');
    return t.done(check.passed ? 'Fear Check passes' : 'Fear Check fails', check.passed ? 'fear' : 'neutral', { total: check.roll }, question || 'Fear Check');
  }

  if (kind === 'duality-scene') {
    const asked = question || state.scene.title || 'Set the scene';
    // Every scene gets a complication; the Fear Check then decides whether the scene changes outright.
    const complication = t.row('scene-complication');
    const available = t.fear;
    const check = t.check();
    const outcome = resolveDualityScene(check.roll, available);
    if (outcome === 'expected') { t.lines.push('The scene starts as you described, with this complication.'); return t.done(`Complication: ${complication.value}`, 'neutral', { total: check.roll }, asked); }
    t.spend();
    if (outcome === 'altered') {
      t.lines.push('Odd roll: the scene is Altered.');
      const altered = t.row('altered-scene');
      const title = altered.roll === 12 ? `${complication.value} + ${t.row('scene-complication').value}` : `${altered.value} · ${complication.value}`;
      return t.done(`Altered scene: ${title}`, 'fear', { total: check.roll }, asked);
    }
    t.lines.push('Even roll: the scene is Interrupted. This Random Event replaces it (drop the complication).');
    return t.done(`Interrupted scene: ${t.randomEvent()}`, 'revelation', { total: check.roll }, asked);
  }

  if (kind === 'duality-move') {
    const trigger = text(input.trigger, 30);
    const needsCheck = trigger === 'failure-fear' || trigger === 'stall';
    const available = t.fear;
    const check = needsCheck ? t.check() : undefined;
    const move = resolveDualityMove(trigger, check?.roll, available);
    if (move === 'none') { t.lines.push('Nothing moves against you. Carry on.'); return t.done('No move', 'neutral', { total: check?.roll }, question || 'GM Move'); }
    if (move === 'hard') { t.spend(); return t.done(`Hard Move: ${t.hardMove()}`, 'fear', { total: check?.roll }, question || 'GM Move'); }
    return t.done(`Soft Move: ${t.softMove()}`, 'neutral', { total: check?.roll }, question || 'GM Move');
  }

  if (kind === 'duality-event') {
    const focus = input.focus === undefined || input.focus === '' || input.focus === null ? undefined : Number(input.focus);
    if (focus !== undefined && (!Number.isInteger(focus) || focus < 1 || focus > 12)) throw new Error('Invalid event focus');
    return t.done(t.randomEvent(focus), 'revelation', {}, question || 'Random Event');
  }

  if (kind === 'duality-meaning') {
    const count = typeof input.count === 'number' && Number.isInteger(input.count) && input.count >= 1 && input.count <= 4 ? input.count : 1;
    const choiceId = text(input.choice, 40, 'action-subject');
    if (choiceId === 'generic') {
      const what = t.meaning(['descriptor', 'subject']);
      t.lines.push('What it does:'); t.meaning(['action']);
      t.row('how-much');
      return t.done(what, 'neutral', {}, question || 'Generic generator');
    }
    const choice = DUALITY_MEANING_CHOICES.find(item => item.id === choiceId);
    if (!choice) throw new Error('Invalid meaning table');
    const phrases = Array.from({ length: count }, () => t.meaning(choice.tables));
    return t.done(count === 1 ? phrases[0]! : 'Meaning', 'neutral', {}, question || choice.label);
  }

  if (kind === 'duality-adversary') {
    const check = t.check();
    const asked = question || (input.chain === true ? 'Chain: next adversary' : 'GM spotlight');
    if (input.chain === true) {
      if (!check.passed) { t.lines.push('The GM turn ends. The spotlight returns to you.'); return t.done('GM turn ends', 'hope', { total: check.roll }, asked); }
      t.spend();
      t.lines.push('1 Fear: another adversary takes the spotlight.');
      return t.done(`Next adversary: ${t.row('tactics').value}`, 'fear', { total: check.roll }, asked);
    }
    if (!check.passed) { t.lines.push('It acts for free.'); return t.done(t.row('tactics').value, 'neutral', { total: check.roll }, asked); }
    const spendRoll = t.d12(), spend = resolveFearSpend(spendRoll);
    t.lines.push(`Fear Spend d12 ${spendRoll}: ${spend.action}`);
    if (spend.cost && !t.spend(spend.cost)) { t.lines.push('Not enough Fear for that: it acts for free.'); return t.done(t.row('tactics').value, 'neutral', { total: check.roll }, asked); }
    if (spend.featureCost) t.lines.push('Pay the feature’s own Fear cost on the Fear tracker. If you cannot afford it, roll Tactics.');
    const title = spend.hardMove ? `Hard Move: ${t.hardMove()}` : spend.action;
    t.lines.push('After it acts, roll “Chain” to see if another adversary follows.');
    return t.done(title, 'fear', { total: check.roll }, asked);
  }

  if (kind === 'duality-encounter') {
    const tier = input.tier === undefined || input.tier === null || input.tier === '' ? undefined : Number(input.tier);
    if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 4)) throw new Error('Invalid tier');
    const creature = t.row('adversary-creature', 0), situation = t.row('adversary-creature', 1), type = t.row('adversary-type');
    if (creature.roll === 12) t.meaning(['descriptor', 'subject']);
    const typeName = adversaryTypeName(type.roll);
    const suggestions = suggestAdversaries(typeName, creature.roll, tier, () => t.d12());
    if (suggestions.length) t.lines.push(`From the catalog${tier ? ` (tier ${tier})` : ''}: ${suggestions.map(item => item.name).join(', ')}. Reskin to fit if needed.`);
    t.lines.push('Build the fight with Battle Points as normal. Ask the Oracle whether they notice you first.');
    const creatureName = creature.value.split(':')[0]!;
    return t.done(`${typeName} · ${creatureName} · ${situation.value.toLowerCase()}`, typeName === 'Solo' || typeName === 'Leader' ? 'fear' : 'neutral', { suggestions }, question || 'Encounter');
  }

  if (kind === 'duality-npc') {
    const role = t.row('npc-identity', 0), motive = t.row('npc-identity', 1), attitude = t.row('npc-manner', 0);
    t.row('npc-manner', 1); t.row('npc-manner', 2);
    const name = t.name();
    t.lines.push('Choose ancestry and community to fit the place.');
    return t.done(`${name}: ${attitude.value.toLowerCase()} ${role.value.toLowerCase()} who wants ${motive.value.toLowerCase()}`, 'neutral', {}, question || 'NPC');
  }

  if (kind === 'duality-generate') {
    const found = dualityTable(text(input.tableId, 60));
    if (!GENERATED_TABLES.includes(found.id)) throw new Error('Invalid table');
    if (found.id === 'names') return t.done(t.name(), 'neutral', {}, question || 'Name');
    if (found.id === 'place-name') return t.done(t.placeName(), 'neutral', {}, question || 'Place name');
    if (found.id === 'settlement') {
      // Size, Known for and Trouble are all rolled; the title names the first two.
      const name = t.placeName(), [size, known] = found.columns.map((_, column) => t.row(found.id, column).value);
      return t.done(`${name}: ${size!.toLowerCase()} known for ${known!.toLowerCase()}`, 'neutral', {}, question || 'Settlement');
    }
    if (found.id === 'hazard') {
      // A hazard's failure belongs to that hazard: one d12 reads the whole row.
      const roll = t.d12(), [hazard, failure] = found.columns.map((column, index) => {
        t.cells.push({ table: found.id, column: index, roll });
        return column.entries[roll - 1]!;
      });
      t.lines.push(`Hazard d12 ${roll}: ${hazard}. On a failure: ${failure}`);
      return t.done(`${hazard} · ${failure}`, 'fear', { total: roll }, question || 'Hazard');
    }
    const values = found.columns.map((_, column) => t.row(found.id, column).value);
    return t.done(values.join(' · '), 'neutral', {}, question || found.title);
  }

  if (kind === 'duality-plot') {
    const objective = t.row('plot-hook', 0), opposition = t.row('plot-hook', 1);
    t.row('plot-stakes', 0); t.row('plot-stakes', 1);
    t.lines.push('Keep the Twist hidden until a Random Event or Hard Move gives it an opening.');
    return t.done(`${objective.value} · ${opposition.value}`, 'neutral', {}, question || 'Plot hook');
  }

  if (kind === 'duality-site') {
    const area = t.row('site', 0), exits = t.row('site', 1), contents = t.row('site', 2);
    if (contents.roll === 12) t.meaning(['descriptor', 'subject']);
    return t.done(`${area.value} · exits: ${exits.value.toLowerCase()} · ${contents.value}`, area.roll === 12 ? 'revelation' : 'neutral', {}, question || 'New area');
  }

  if (kind === 'duality-journey') {
    const check = t.check();
    if (check.passed) { t.spend(); return t.done(`Danger: ${t.row('journey', 0).value}`, 'fear', { total: check.roll }, question || 'Journey leg'); }
    return t.done(`Discovery: ${t.row('journey', 1).value}`, 'hope', { total: check.roll }, question || 'Journey leg');
  }

  if (kind === 'duality-table') {
    const found = dualityTable(text(input.tableId, 60));
    const column = input.column === undefined || input.column === null ? 0 : Number(input.column);
    if (!Number.isInteger(column) || column < 0 || column >= found.columns.length) throw new Error('Invalid table column');
    const rolled = t.row(found.id, column);
    return t.done(rolled.value, 'neutral', { total: rolled.roll }, question || found.title);
  }

  if (kind === 'duality-list') {
    const list = text(input.list, 20) as DualityList;
    if (!(list in LIST_LABELS)) throw new Error('Invalid list');
    return t.done(t.list(list) ?? 'Empty list', 'neutral', {}, question || `${LIST_LABELS[list]} list`);
  }

  throw new Error('Invalid solo roll type');
}

/** Words in a catalog adversary's name or description that fit each Creature row. */
const CREATURE_WORDS: RegExp[] = [
  /beast|wolf|bear|boar|hound|predator|serpent|snake|spider|burrower|stag|eagle|hawk/i,
  /swarm|rats?\b|vermin|insect|bats?\b|crows?\b/i,
  /bandit|outlaw|raider|soldier|guard|knight|archer|brigand|mercenar|sellsword|thug/i,
  /cult|zealot|acolyte|fanatic|priest|devotee/i,
  /undead|skeleton|zombie|ghoul|corpse|lich|bones?\b|rotted/i,
  /ghost|spirit|spectr|wraith|phantom|haunt/i,
  /construct|golem|automaton|clockwork|animated/i,
  /elemental|storm|flame|living stone|earth|wind/i,
  /fae|fey|dryad|sprite|pixie|treant|sylvan/i,
  /demon|fiend|devil|infernal/i,
  /giant|troll|dragon|wyrm|drake|ogre/i,
  /aberra|horror|eldritch|tentacle|ooze|void/i,
];
/**
 * Up to three catalog adversaries of the rolled type (and tier, when given), preferring ones whose
 * name or description fits the creature. Picks with the roll's own d12s so a seeded roll repeats.
 */
export function suggestAdversaries(type: string, creatureRoll: number, tier: number | undefined, d12: () => number): { id: string; name: string }[] {
  const pool = adversaries.filter(item => item.type === type && (tier === undefined || item.tier === tier));
  const words = CREATURE_WORDS[creatureRoll - 1];
  const fitting = words ? pool.filter(item => words.test(`${item.name} ${item.description ?? ''}`)) : [];
  const source = [...(fitting.length ? fitting : pool)];
  const picked: { id: string; name: string }[] = [];
  while (source.length && picked.length < 3) {
    const [item] = source.splice(Math.floor((d12() - 1) / 12 * source.length), 1);
    picked.push({ id: item!.id, name: item!.name });
  }
  return picked;
}

/** Tables that `duality-generate` rolls whole: one d12 per column. */
export const GENERATED_TABLES = ['names', 'place-name', 'settlement', 'wilds', 'faction', 'treasure', 'rumor', 'hazard', 'rest'];
