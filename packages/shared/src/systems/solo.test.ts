import { describe, expect, test } from 'vitest';
import { canReadDocument, canWriteDocument, DEFAULT_CONFIGURATION, GAME_SYSTEMS, getRuleset, hasFeature, normalizeConfiguration, type GameSystemDefinition } from './registry';
import { initialSoloState, resolveSoloOracle, resolveSoloScene, soloPrompt, SOLO_THEMES } from './daggerheart/solo';

describe('campaign system registry', () => {
  test('a registered future system keeps its own options and document policies without inheriting Daggerheart tools', () => {
    const system: GameSystemDefinition = { id: 'test-system', name: 'Test system', rulesets: [{ id: 'standard', name: 'Standard', mode: 'group', version: '1', description: 'Test', features: ['test-system.characters'], documents: [{ namespace: 'test-characters', read: 'members', write: 'members' }], normalizeOptions: options => ({ custom: options.custom ?? true }) }] };
    const registry = GAME_SYSTEMS as GameSystemDefinition[];
    registry.push(system);
    try {
      const configuration = normalizeConfiguration({ systemId: system.id, rulesetId: 'standard', options: { custom: false } });
      expect(configuration.options).toEqual({ custom: false });
      expect(hasFeature(configuration, 'daggerheart.solo')).toBe(false);
      expect(canWriteDocument(configuration, 'player', 'test-characters')).toBe(true);
      expect(canReadDocument(configuration, 'gm', 'sheets', 'hero')).toBe(false);
    } finally { registry.pop(); }
  });
  test('defaults only omitted configuration; rejects unknown systems, incompatible rulesets, and invalid options', () => {
    expect(normalizeConfiguration()).toEqual(DEFAULT_CONFIGURATION);
    for (const value of [null, {}, { systemId: 'missing', rulesetId: 'core' }, { systemId: 'daggerheart', rulesetId: 'missing' }, { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'whatever' } }, { systemId: 'daggerheart', rulesetId: 'solo', options: { fearThreshold: '3' } }]) expect(() => normalizeConfiguration(value)).toThrow();
    const solo = normalizeConfiguration({ systemId: 'daggerheart', rulesetId: 'solo' });
    expect(solo.options).toEqual({ partyMode: 'lone', fearThreshold: 3, partySize: 2 });
    expect(getRuleset(solo)?.features).toContain('daggerheart.solo');
    expect(canReadDocument(solo, 'player', 'solo', 'state')).toBe(false);
    expect(canWriteDocument(solo, 'gm', 'daggerheart.solo')).toBe(false);
    expect(canReadDocument(solo, 'player', 'combat', 'fear')).toBe(true);
    expect(canWriteDocument(solo, 'gm', 'combat', 'fear')).toBe(false);
    expect(canReadDocument(DEFAULT_CONFIGURATION, 'gm', 'solo', 'state')).toBe(false);
  });
});
describe('solo duality engine', () => {
  test('all 144 pairs give the documented odds and scene distribution', () => {
    const yes = [0, 0, 0, 0, 0], bands = ['very-likely', 'likely', 'even', 'unlikely', 'very-unlikely'];
    const scenes: Record<string, number> = {};
    for (let hope = 1; hope <= 12; hope++) for (let fear = 1; fear <= 12; fear++) {
      bands.forEach((band, index) => { if (resolveSoloOracle(hope, fear, band).title.startsWith('Yes')) yes[index]!++; });
      const scene = resolveSoloScene(hope, fear, 1); scenes[scene.title] = (scenes[scene.title] ?? 0) + 1;
    }
    expect(yes).toEqual([126, 104, 72, 44, 24]);
    expect(scenes).toEqual({ 'Unexpected connection': 12, 'A changed circumstance': 21, 'An opportunity': 21, 'As expected': 90 });
  });
  test('theme dice are independent of inherited tone; content doubles trigger nothing', () => {
    const pool = initialSoloState().pool; pool[0] = 'The missing keeper';
    const result = soloPrompt({ theme: 'mystery', secondaryTheme: 'dread', pool, tone: 'fear' }, () => 0);
    expect(result.anchor).toBe('The missing keeper');
    expect(result.hope).toBe(result.fear);
    expect(result.tone).toBe('fear');
    expect(result.title).toBe(`${SOLO_THEMES[0].subjects[0]} / ${SOLO_THEMES[4].developments[0]}`);
    expect(result).not.toHaveProperty('critical');
    for (const theme of SOLO_THEMES) {
      expect(new Set(theme.subjects).size).toBe(12); expect(new Set(theme.developments).size).toBe(12);
    }
  });
});
