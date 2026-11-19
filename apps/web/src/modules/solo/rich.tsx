import { Fragment, type ReactNode } from 'react';
import { IRON_MOVES } from '@daggery/shared';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBER = '[+\\u2212-]\\d+';
// Longest names first, so "Face Danger or Secure an Advantage (in a scene)" wins over "Face Danger".
const NAMES = [...IRON_MOVES].sort((a, b) => b.name.length - a.name.length);
const PATTERN = new RegExp(
  `((?:[Tt]ake|[Ss]uffer) ${NUMBER} (?:momentum|supply|health|spirit)|${NAMES.map(move => escapeRegex(move.name)).join('|')})`,
);
const TOKEN = new RegExp(`^(take|suffer) ${NUMBER} `, 'i');

/**
 * Move text with the parts that matter picked out: Momentum, Supply and health gains in gold, losses in rose,
 * and every move name a link to that move. Plain text stays plain.
 */
export function Rich({ text, self }: { text: string; self?: string }): ReactNode {
  return text.split(PATTERN).map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    const move = NAMES.find(item => item.name === part);
    if (move) return move.id === self ? <i key={index}>{part}</i> : <a key={index} className="solo-move-link" href={`#solo-moves-${move.id}`}>{part}</a>;
    const loss = /^suffer/i.test(part) || /^take [−-]/i.test(part);
    return <mark key={index} className={`solo-token ${loss ? 'is-loss' : 'is-gain'}`}>{part.replace(TOKEN, match => match).replace('-', '−')}</mark>;
  });
}
