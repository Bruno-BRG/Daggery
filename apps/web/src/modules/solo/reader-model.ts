import { DUALITY_LIKELIHOODS, IRON_MOVE_GROUPS, IRON_MOVES, dualityTable } from '@daggery/shared';
import { SOLO_SECTIONS } from './reference';
import type { Step } from './workflow';

export interface ReaderEntry {
  id: string;
  title: string;
  group: string;
  kind: 'table' | 'move' | 'rule';
  text: string;
}

export const readerSectionId = (id: string) => `solo-reader-section-${id}`;
export const readerMoveId = (id: string) => `solo-reader-move-${id}`;
export const readerRuleId = (section: string, index: number) => `solo-reader-rule-${section}-${index}`;
export const READER_ORACLE_ID = 'solo-reader-oracle';

/** Small, prebuilt index. Searching it never filters or rebuilds the document. */
export const READER_ENTRIES: readonly ReaderEntry[] = [
  {
    id: READER_ORACLE_ID, title: 'Ask the Oracle', group: 'Quick reference', kind: 'rule',
    text: `yes no likelihood doubles Hope Fear ${DUALITY_LIKELIHOODS.map(item => `${item.label} ${item.target} ${item.chance}`).join(' ')}`,
  },
  ...SOLO_SECTIONS.flatMap(section => section.tables.map(id => {
    const table = dualityTable(id);
    return {
      id: `solo-table-${id}`, title: table.title, group: section.label, kind: 'table' as const,
      text: `${table.title} ${section.label} ${table.columns.map(column => `${column.label} ${column.entries.join(' ')}`).join(' ')}`,
    };
  })),
  ...IRON_MOVE_GROUPS.flatMap(group => IRON_MOVES.filter(move => move.group === group.id).map(move => ({
    id: readerMoveId(move.id), title: move.name, group: group.label, kind: 'move' as const,
    text: `${move.name} ${move.trigger} ${move.roll ?? ''} ${move.text ?? ''} ${move.strong ?? ''} ${move.weak ?? ''} ${move.miss ?? ''}`,
  }))),
  ...SOLO_SECTIONS.flatMap(section => section.reference.map((block, index) => ({
    id: readerRuleId(section.id, index), title: block.title, group: `${section.label} reference`, kind: 'rule' as const,
    text: `${block.title} ${block.note ?? ''} ${block.rows.flat().join(' ')}`,
  }))),
];

export function findReaderEntries(query: string): readonly ReaderEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return READER_ENTRIES;
  return READER_ENTRIES.filter(entry => words.every(word => `${entry.title} ${entry.text}`.toLowerCase().includes(word)));
}

const targets = new Set([
  ...READER_ENTRIES.map(entry => entry.id),
  ...SOLO_SECTIONS.map(section => readerSectionId(section.id)),
  'solo-reader-top', 'solo-reader-moves', 'solo-reader-rules',
]);

/** Current document anchors and old solo URLs point into the same continuous page. */
export function resolveReaderHash(hash: string): string | undefined {
  const id = hash.replace(/^#/, '');
  if (targets.has(id)) return id;
  if (id === 'solo-oracle') return READER_ORACLE_ID;
  if (id === 'solo-rules') return 'solo-reader-rules';
  if (id === 'solo-moves') return 'solo-reader-moves';
  const moveId = id.replace(/^solo-moves-/, '');
  if (id.startsWith('solo-moves-') && IRON_MOVES.some(move => move.id === moveId)) return readerMoveId(moveId);
  const sectionId = id.replace(/^solo-(?:tables-)?/, '');
  if (SOLO_SECTIONS.some(section => section.id === sectionId)) return readerSectionId(sectionId);
  return undefined;
}

export function readerStepTarget(step: Step): { id: string; label: string } {
  if (step.kind === 'table') return { id: `solo-table-${step.table}`, label: step.label ?? dualityTable(step.table).title };
  if (step.kind === 'meaning') return { id: `solo-table-${step.first}`, label: step.first === 'action' ? 'Action + Subject' : 'Descriptor + Subject' };
  if (step.kind === 'fear-check') {
    const section = SOLO_SECTIONS.find(section => section.id === 'core')!;
    const index = section.reference.findIndex(block => block.title === 'Fear Check');
    return { id: readerRuleId(section.id, index), label: 'Fear Check' };
  }
  return { id: READER_ORACLE_ID, label: 'Ask the Oracle' };
}
