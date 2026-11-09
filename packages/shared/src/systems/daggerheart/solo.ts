import { resolveDuality, rollDie, type Rng } from '../../dice';
import { SOLO_THEMES } from './themes';
export { SOLO_THEMES } from './themes';
export const SOLO_RULES_VERSION = '0.2';
export const SOLO_LIKELIHOODS = [
  { id: 'very-likely', label: 'Very likely', target: 8, chance: '87.5%' },
  { id: 'likely', label: 'Likely', target: 11, chance: '72.2%' },
  { id: 'even', label: 'Even', target: 14, chance: '50%' },
  { id: 'unlikely', label: 'Unlikely', target: 17, chance: '30.6%' },
  { id: 'very-unlikely', label: 'Very unlikely', target: 20, chance: '16.7%' },
] as const;
export const SOLO_WORLD_MOVES = [
  'An NPC acts on an established motive.', 'An opponent changes position or blocks an approach.',
  'Evidence reveals an unwelcome truth.', 'A route or opportunity begins to close.',
  'A named deadline draws closer.', 'Equipment, supplies, or composure come under pressure.',
  'A relationship or obligation complicates the choice.', 'Someone or something important is threatened.',
  'The environment presents a concrete hazard.', 'A present adversary uses a relevant action or attacks.',
  'Someone offers a useful but costly bargain.', 'An existing off-screen threat takes its next step.',
] as const;
export const SOLO_TWISTS = [
  'Two apparently separate threads share a cause.', 'A familiar person has an unexpected responsibility.',
  'A supposed obstacle is holding back something worse.', 'An old promise has become urgent.',
  'Your destination is moving or changing.', 'Someone else is pursuing the same objective.',
  'The apparent prize is a means to another end.', 'Help comes from someone with a conflicting motive.',
  'A past decision has an unforeseen consequence.', 'A local dispute matters to a larger faction.',
  'A missing person or object returns in a changed role.', 'The threat and an ally need the same thing.',
] as const;
export const SOLO_EXTRA_TABLES = [
  { id: 'npc', name: 'NPC motive', entries: ['Keep someone safe', 'Recover something lost', 'Avoid exposure', 'Fulfill an obligation', 'Escape someone’s control', 'Secure a scarce resource', 'Win recognition', 'Change the local order', 'Preserve a tradition', 'Settle a grievance', 'Discover forbidden knowledge', 'Leave a dangerous place'] },
  { id: 'intent', name: 'Adversary intent', entries: [
    ...Array<string>(6).fill('Use its main attack/action to pursue its motive.'),
    ...Array<string>(3).fill('Use its setup tactic or reposition toward its objective.'),
    ...Array<string>(2).fill('Pursue the objective directly: escape, seize, break, protect.'),
    'Defend, regroup, bargain, or withdraw if it fits its condition.',
  ] },
  { id: 'twist', name: 'Twist', entries: SOLO_TWISTS },
  { id: 'purpose', name: 'Scene purpose', entries: [
    'What can be learned before the evidence changes?', 'What agreement could let both sides move forward?',
    'What is blocking passage, and what would open it?', 'What must be recovered before it leaves this place?',
    'Who needs protection, and from what immediate risk?', 'What is keeping this system, custom, or mechanism from working?',
    'What trail can still be followed?', 'What would make an escape or retreat possible?',
    'What must be endured until help or an opening arrives?', 'What is happening here that changes an existing belief?',
    'What important things cannot all be preserved?', 'What confrontation can no longer be postponed?',
  ] },
] as const;
export type SoloTone = 'hope' | 'fear' | 'revelation' | 'neutral';
export interface SoloResult {
  title: string; detail: string; hope?: number; fear?: number; total?: number; target?: number;
  tone: SoloTone; anchor?: string; theme?: string; secondaryTheme?: string; anchorDie?: number;
}
export function resolveSoloOracle(hope: number, fear: number, likelihood: string): SoloResult {
  const band = SOLO_LIKELIHOODS.find(item => item.id === likelihood);
  if (!band) throw new Error('Invalid likelihood');
  const result = resolveDuality(hope, fear);
  const yes = result.critical || result.total >= band.target;
  return { hope, fear, total: result.total, target: band.target,
    title: result.critical ? 'Yes — revelation' : `${yes ? 'Yes' : 'No'} with ${result.withFear ? 'Fear' : 'Hope'}`,
    tone: result.critical ? 'revelation' : result.withFear ? 'fear' : 'hope',
    detail: result.critical ? 'The fact is true, with a surprising connection and a usable opening.'
      : yes ? result.withFear ? 'True, with a troubling condition or hidden risk.' : 'True, with a useful opening or helpful detail.'
        : result.withFear ? 'False, and the reason makes the situation harder.' : 'False, but there is an alternative or useful lead.',
  };
}
export function resolveSoloScene(hope: number, fear: number, twistDie?: number): SoloResult {
  const result = resolveDuality(hope, fear);
  if (result.critical) {
    if (!Number.isInteger(twistDie) || twistDie! < 1 || twistDie! > 12) throw new Error('Invalid twist die');
    return { hope, fear, title: 'Unexpected connection', tone: 'revelation', detail: SOLO_TWISTS[twistDie! - 1]! };
  }
  if (hope - fear >= 6) return { hope, fear, title: 'An opportunity', tone: 'hope', detail: 'Keep your goal; introduce one useful opening.' };
  if (fear - hope >= 6) return { hope, fear, title: 'A changed circumstance', tone: 'fear', detail: 'Keep your goal; introduce one obstacle or changed circumstance.' };
  return { hope, fear, title: 'As expected', tone: 'neutral', detail: 'Begin the scene as described.' };
}
export function soloPrompt(options: { theme: string; secondaryTheme?: string; anchor?: string; pool: string[]; tone: SoloTone }, rng?: Rng): SoloResult {
  const primary = SOLO_THEMES.find(theme => theme.id === options.theme);
  const secondary = SOLO_THEMES.find(theme => theme.id === (options.secondaryTheme || options.theme));
  if (!primary || !secondary) throw new Error('Invalid theme');
  let anchor = options.anchor?.trim();
  let anchorDie: number | undefined;
  if (!anchor) { anchorDie = rollDie(12, rng); anchor = options.pool[anchorDie - 1]?.trim() || 'Choose the most relevant existing campaign element.'; }
  const hope = rollDie(12, rng), fear = rollDie(12, rng);
  return { hope, fear, anchor, anchorDie, theme: primary.id, secondaryTheme: secondary.id, tone: options.tone,
    title: `${primary.subjects[hope - 1]} / ${secondary.developments[fear - 1]}`,
    detail: 'Interpret this pair as one concrete development. Content doubles do not trigger another event.',
  };
}
export interface SoloCompanion { id: string; name: string; motive: string; bond: string; specialty: string; tier: number; hpMarked: number; stressMarked: number }
export type SoloActionOutcome = 'critical' | 'success-hope' | 'success-fear' | 'failure-hope' | 'failure-fear';
export const SOLO_ADVANCEMENT: Record<SoloActionOutcome, [number, number]> = {
  critical: [3, 0], 'success-hope': [2, 0], 'success-fear': [1, 1], 'failure-hope': [0, 2], 'failure-fear': [0, 3],
};
export interface SoloState {
  revision: number;
  scene: { title: string; goal: string; expected: string; signature: string; signatureCost: number };
  pool: string[];
  theme: string;
  secondaryTheme: string;
  countdowns: { progress: number; progressStart: number; progressName: string; consequence: number; consequenceStart: number; consequenceName: string };
  companions: SoloCompanion[];
  beat: { id: string; contributions: string[]; fearSpent: boolean; outcomeApplied: boolean; assistedHeroId?: string; assistConsumed?: boolean };
}
export function initialSoloState(): SoloState {
  return { revision: 0, scene: { title: '', goal: '', expected: '', signature: '', signatureCost: 1 },
    pool: Array<string>(12).fill(''), theme: 'mystery', secondaryTheme: '',
    countdowns: { progress: 4, progressStart: 4, progressName: '', consequence: 6, consequenceStart: 6, consequenceName: '' },
    companions: [], beat: { id: 'initial', contributions: [], fearSpent: false, outcomeApplied: false } };
}
export interface SoloEntry { id: string; at: string; kind: string; question: string; result: SoloResult; interpretation: string; accepted: boolean; rulesVersion: string }
export interface SoloEntryPage { entries: SoloEntry[]; nextCursor: string | null }
export interface SoloSnapshot extends SoloEntryPage { state: SoloState }
