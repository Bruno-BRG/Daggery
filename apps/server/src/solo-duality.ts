import { adversaries } from '@daggery/content';
import {
  adversaryTypeName, adversariesForRank, foeRankFor, FOE_RANKS, IRON_LIKELIHOODS, IRON_OUTCOME_LABELS, lodestarTable, readLodestarColumn,
  type LodestarColumn, type LodestarRow,
  resolveIronProgress, DUALITY_MEANING_CHOICES, dualityTable, fearCheck, readDualityMeaning,
  readDualityTable, resolveFearSpend, rollDie,
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
  d100() { return rollDie(100, this.roll.rng); }
  /** One d100 on a Lodestar column, written to the lines. The dice show 00 for 100. */
  lodestar(column: LodestarColumn, label = column.label): { roll: number; row: LodestarRow } {
    const roll = this.d100(), row = readLodestarColumn(column, roll);
    this.lines.push(`${label} d100 ${roll === 100 ? '00' : roll}: ${row[2]}`);
    return { roll, row };
  }
  /**
   * A d100 result that says "Roll twice" or "Roll again" is followed here: both results happen, and
   * the same result twice is made worse. Further "roll twice" rows are rerolled so it cannot recurse.
   */
  lodestarFollow(column: LodestarColumn, first: { row: LodestarRow }): string {
    const text = first.row[2];
    if (/^Roll twice/.test(text)) {
      const picked: LodestarRow[] = [];
      for (let tries = 0; picked.length < 2 && tries < 200; tries++) {
        const next = this.lodestar(column);
        if (!/^Roll (twice|again)/.test(next.row[2])) picked.push(next.row);
      }
      if (picked.length < 2) throw new Error('Could not resolve a double roll');
      const same = picked[0]![2] === picked[1]![2];
      this.lines.push(same ? 'The same result twice: make it worse (or more dramatic).' : 'Both results happen.');
      return same ? `${picked[0]![2]} (worse)` : picked.map(row => row[2]).join(' + ');
    }
    if (/^Roll again/.test(text)) {
      for (let tries = 0; tries < 200; tries++) {
        const next = this.lodestar(column);
        if (!/^Roll again/.test(next.row[2])) { this.lines.push('Apply that result, but make it worse.'); return `${next.row[2]} (worse)`; }
      }
      throw new Error('Could not resolve a reroll');
    }
    return text;
  }
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
  /** One price; a 12 resolves two non-recursive prices, keeping every die in the result. */
  price(): string {
    const first = this.row('iron-price');
    if (first.roll !== 12) return first.value;
    this.lines.push('Two prices: both happen.');
    const prices: string[] = [];
    for (let attempts = 0; prices.length < 2 && attempts < 200; attempts++) {
      const next = this.row('iron-price');
      if (next.roll !== 12) prices.push(next.value);
    }
    if (prices.length < 2) throw new Error('Could not resolve Pay the Price');
    return prices.join(' + ');
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

  // ------------------------------------------------------------------- Duality GME
  if (kind === 'iron-oracle' || kind === 'duality-oracle') {
    if (!question && roll.advisory) throw new Error('Invalid question');
    const hope = t.d12(), fear = t.d12(), likelihood = text(input.likelihood, 30, 'even');
    const band = IRON_LIKELIHOODS.find(item => item.id === likelihood);
    if (!band) throw new Error('Invalid likelihood');
    const total = hope + fear, yes = total >= band.target, match = hope === fear;
    t.lines.push(`Hope ${hope} + Fear ${fear} = ${total} · ${band.label} needs ${band.target}+`);
    if (match) t.lines.push('The dice match: an extreme result or a twist.');
    return t.done(`${yes ? 'Yes' : 'No'}${match ? ', with a twist' : ''}`, match ? 'revelation' : 'neutral', { hope, fear, total, target: band.target }, question || 'Ask the Oracle');
  }

  if (kind === 'iron-progress') {
    const score = typeof input.score === 'number' ? input.score : Number(input.score);
    const name = text(input.name ?? '', 120, '').trim();
    const c1 = rollDie(10, roll.rng), c2 = rollDie(10, roll.rng), result = resolveIronProgress(score, c1, c2);
    t.lines.push(`Progress ${score} vs challenge dice ${c1} and ${c2}`);
    if (result.match) t.lines.push('The challenge dice match: a twist or an extreme result.');
    const tone: SoloTone = result.outcome === 'strong' ? 'hope' : result.outcome === 'miss' ? 'fear' : 'neutral';
    return t.done(`${IRON_OUTCOME_LABELS[result.outcome]}${result.match ? ' (match)' : ''}`, result.match ? 'revelation' : tone, { total: score }, question || name || 'Progress roll');
  }

  if (kind === 'iron-price') {
    const severe = input.severe === true;
    const prices = [t.price()];
    if (severe) {
      if (t.spend()) { t.lines.push('Severe: the GM spends 1 Fear and a second price lands.'); prices.push(t.price()); }
      else t.lines.push('Severe, but the GM has no Fear to spend: one price.');
    }
    return t.done(prices.join(' + '), 'fear', {}, question || (severe ? 'Pay the Price (severe)' : 'Pay the Price'));
  }

  if (kind === 'duality-fear-check') {
    const check = t.check();
    t.lines.push(check.passed ? 'The GM acts. Spend Fear for what it does.' : 'The world holds its breath.');
    return t.done(check.passed ? 'Fear Check passes' : 'Fear Check fails', check.passed ? 'fear' : 'neutral', { total: check.roll }, question || 'Fear Check');
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
    const title = spend.hardMove ? `Severe Pay the Price: ${t.price()} + ${t.price()}` : spend.action;
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
    t.lines.push(tier !== undefined
      ? `Foe rank: ${FOE_RANKS.find(item => item.id === foeRankFor(typeName, tier))!.label} (a tier ${tier} ${typeName}).`
      : `Foe rank by tier: ${[1, 2, 3, 4].map(level => `${FOE_RANKS.find(item => item.id === foeRankFor(typeName, level))!.label} (tier ${level})`).join(', ')}.`);
    t.lines.push('Enter the Fray with that rank, or build the fight with Battle Points as normal. Ask the Oracle whether they notice you first.');
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
    t.lines.push('Reveal the Twist when a move, a matching oracle roll or the fiction gives it an opening.');
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

  if (kind === 'duality-lodestar') {
    const found = lodestarTable(text(input.tableId, 60));
    if (found.id === 'settlement-name') {
      // A category first, then an example from that category's own list.
      const [categories, ...lists] = found.columns;
      const category = t.lodestar(categories!, 'Category');
      const index = categories!.rows.findIndex(row => row === category.row);
      const example = t.lodestar(lists[index]!, lists[index]!.label);
      return t.done(example.row[2], 'neutral', { total: example.roll }, question || found.title);
    }
    if (found.id === 'quick-settlement-name') {
      const prefix = t.lodestar(found.columns[0]!), suffix = t.lodestar(found.columns[1]!);
      return t.done(`${prefix.row[2].replace(/-$/, '')}${suffix.row[2].replace(/^-/, '')}`, 'neutral', {}, question || found.title);
    }
    if (found.id === 'challenge-rank') {
      const rank = t.lodestar(found.columns[0]!), index = found.columns[0]!.rows.findIndex(row => row === rank.row);
      for (const column of found.columns.slice(1)) t.lines.push(`${column.label}: ${column.rows[index]![2]}`);
      const duality = FOE_RANKS.find(item => item.ironsworn === rank.row[2]);
      if (duality) t.lines.push(`In Duality GME this rank is ${duality.label}.`);
      return t.done(rank.row[2], rank.row[2] === 'Epic' || rank.row[2] === 'Extreme' ? 'fear' : 'neutral', { total: rank.roll }, question || found.title);
    }
    let column = 0;
    if (found.columns.length > 1) {
      column = input.column === undefined || input.column === null ? 0 : Number(input.column);
      if (!Number.isInteger(column) || column < 0 || column >= found.columns.length) throw new Error('Invalid table column');
    }
    const rolled = t.lodestar(found.columns[column]!);
    return t.done(t.lodestarFollow(found.columns[column]!, rolled), found.id === 'pay-the-price' || found.id === 'mystic-backlash' ? 'fear' : 'neutral', { total: rolled.roll }, question || found.title);
  }

  if (kind === 'duality-foe-rank') {
    // Rolls a foe's rank (Challenge Rank, Foes column), then names the Daggerheart adversaries that fit it.
    const challenge = lodestarTable('challenge-rank'), rolled = t.lodestar(challenge.columns[0]!, 'Challenge rank');
    const rank = FOE_RANKS.find(item => item.ironsworn === rolled.row[2])!;
    t.lines.push(`Duality GME rank: ${rank.label}. Harm ${rank.harm} against you; ${rank.progress}. ${rank.foe}.`);
    const fits = adversariesForRank(rank.id);
    t.lines.push(`Look for: ${rank.fits}.`);
    const pool = adversaries.filter(item => foeRankFor(item.type, item.tier) === rank.id);
    const source = [...pool], picked: { id: string; name: string }[] = [];
    while (source.length && picked.length < 3) {
      const [item] = source.splice(Math.floor((t.d12() - 1) / 12 * source.length), 1);
      picked.push({ id: item!.id, name: item!.name });
    }
    if (picked.length) t.lines.push(`From the catalog: ${picked.map(item => item.name).join(', ')}.`);
    return t.done(`${rank.label} foe (${fits.length} type and tier pairs fit)`, rank.harm >= 4 ? 'fear' : 'neutral', { total: rolled.roll, suggestions: picked }, question || 'Foe rank');
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
export const GENERATED_TABLES = ['names', 'place-name', 'settlement', 'wilds', 'faction', 'treasure', 'rumor', 'hazard', 'rest', 'iron-vignette', 'iron-waypoint', 'iron-opportunity', 'iron-discovery', 'iron-chaos'];
