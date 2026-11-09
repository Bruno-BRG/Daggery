import type { DocumentPolicy, GameSystemDefinition } from '../types';
import type { SoloState } from './solo';
const documents: DocumentPolicy[] = [
  { namespace: 'sheets', read: 'members', write: 'members' },
  { namespace: 'map', read: 'gm', write: 'gm' },
  { namespace: 'combat', read: 'gm', write: 'gm', publicIds: ['fear'], protectedIds: ['fear'] },
  { namespace: 'gm', read: 'gm', write: 'gm' },
];
const features = ['daggerheart.table', 'daggerheart.sheets', 'daggerheart.compendium', 'daggerheart.gm-tools', 'daggerheart.duality', 'daggerheart.ai-gm'];
export const DAGGERHEART: GameSystemDefinition = {
  supportsAiGm: true,
  configurationChanged: ({ before, after, readDocument, newId }) => {
    if (before.rulesetId === after.rulesetId && before.options.partyMode === after.options.partyMode) return [];
    const state = readDocument('solo', 'state') as SoloState | undefined;
    return state ? [{ ns: 'solo', id: 'state', value: { ...state, revision: state.revision + 1, beat: { id: newId(), contributions: [], fearSpent: false, outcomeApplied: false } } }] : [];
  },
  id: 'daggerheart', name: 'Daggerheart', rulesets: [
    { id: 'core', name: 'Daggerheart · Group', description: 'Play with a Game Master and a group.', mode: 'group', version: '2.0', features,
      documents, normalizeOptions: value => { if (Object.keys(value).length) throw new Error('Invalid ruleset options'); return {}; } },
    { id: 'solo', name: 'Daggerheart Solo', description: 'Hope & Fear oracles, scene themes, and a campaign journal.', mode: 'solo', version: '0.2',
      features: [...features, 'daggerheart.solo'], documents: [...documents, { namespace: 'solo', read: 'gm', write: 'server', realtimeIds: ['state'] }],
      initialDocuments: options => [{ ns: 'combat', id: 'fear', value: { kind: 'fear', value: options.partyMode === 'party' ? options.partySize : 1 } }],
      normalizeOptions: value => {
        if (Object.keys(value).some(key => !['partyMode', 'fearThreshold', 'partySize'].includes(key))) throw new Error('Invalid solo options');
        const partyMode = value.partyMode ?? 'lone', fearThreshold = value.fearThreshold ?? 3;
        const partySize = value.partySize ?? 2;
        if (!['lone', 'companion', 'party'].includes(String(partyMode)) || ![3, 5].includes(Number(fearThreshold)) || typeof fearThreshold !== 'number') throw new Error('Invalid solo options');
        if (partySize !== 2 && partySize !== 3) throw new Error('Invalid solo party size');
        return { partyMode, fearThreshold, partySize };
      } },
  ],
};
