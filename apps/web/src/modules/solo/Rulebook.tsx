import { Fragment, type ReactNode } from 'react';
import gme from '../../../../../docs/solo-rules-gme.md?raw';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return /^https:\/\//.test(link[2]!) ? <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : <span key={index}>{link[1]}</span>;
    return part;
  });
}
function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/), blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^#{1,4} /.test(line)) {
      const match = line.match(/^(#{1,4}) (.*)$/)!;
      const content = inline(match[2]!);
      blocks.push(match[1]!.length <= 2 ? <h2 key={i}>{content}</h2> : <h3 key={i}>{content}</h3>); i++; continue;
    }
    if (line.startsWith('|')) {
      const start = i, rows: string[][] = [];
      while (lines[i]?.startsWith('|')) { const cells = lines[i]!.split('|').slice(1, -1).map(cell => cell.trim()); if (!cells.every(cell => /^[-: ]+$/.test(cell))) rows.push(cells); i++; }
      blocks.push(<div className="solo-reference-table" key={start}><table><thead><tr>{rows[0]?.map((cell, col) => <th key={col} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
      const start = i, ordered = /^\d+\. /.test(line), items: ReactNode[] = [];
      while (lines[i] && (/^[-*] /.test(lines[i]!) || /^\d+\. /.test(lines[i]!))) {
        let text = lines[i++]!.replace(/^([-*]|\d+\.) /, '');
        while (lines[i] && /^ {2,}\S/.test(lines[i]!)) text += ' ' + lines[i++]!.trim();
        items.push(<li key={i}>{inline(text)}</li>);
      }
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>); continue;
    }
    const start = i; let paragraph = lines[i++]!;
    while (lines[i]?.trim() && !/^(#|\||[-*] |\d+\. )/.test(lines[i]!)) paragraph += ' ' + lines[i++]!.trim();
    blocks.push(<p key={start}>{inline(paragraph)}</p>);
  }
  return <>{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</>;
}
const difficulty = '## Set the Difficulty\n' + gme.split('## Set the Difficulty\n')[1]!.split('\n## Progress tracks')[0]!;

export function Rulebook({ onReturn }: { onReturn?: () => void }) {
  return <section className="solo-panel solo-rulebook solo-guide" aria-labelledby="solo-guide-title">
    <header className="solo-guide-heading">
      <div><h2 id="solo-guide-title">Solo Play guide</h2><p className="solo-muted">A reference to visit when you need it. Your play loop stays in Play.</p></div>
      {onReturn && <button type="button" className="daggery-roll-toggle" onClick={onReturn}>Back to play</button>}
    </header>
    <details><summary>How to use Solo Play</summary>
      <h3>Start with your character</h3><p>Create a Daggerheart character in Characters, then begin your adventure. Character resources stay close at hand; on a phone, expand Character resources to mark HP, Stress or Armor, spend Hope, or adjust Fear.</p>
      <h3>Follow the play loop</h3><p>Take an oath, begin a session, and describe what your character does. Make a move when its trigger fits, read the outcome, and mark progress toward your goals. Choose an entry in the left rail on a computer, or use What happens next? on a phone. Previous and Next step move between panels; you can revisit any step without completing the others.</p>
      <h3>Roll, interpret, continue</h3><p>Use the panel's roll button, then interpret the result in the current scene. Reference tables start folded away and open to show the rows a roll used. Keep in notes saves your interpretation; you can also write in your own notebook.</p>
      <h3>Use the other sections when needed</h3><ul><li><strong>All tables:</strong> browse and roll reference tables.</li><li><strong>Generators:</strong> create people, places and other story details.</li><li><strong>Threads &amp; NPCs:</strong> keep goals, characters, scene notes and countdowns.</li><li><strong>Dice:</strong> roll additional dice, or use physical dice where a panel offers that option.</li><li><strong>Notes:</strong> revisit results and the interpretations you kept.</li></ul>
      <p>Changing steps or opening this guide keeps drafts and recent panel results in place. Save anything you want to keep before reloading the page.</p>
    </details>
    <details className="solo-guide-difficulty"><summary>Set the Difficulty</summary><p className="solo-muted">Duality GME · Use an existing value first. Otherwise, start at 13 and count established obstacles.</p><Markdown source={difficulty.replace('## Set the Difficulty\n', '')} /></details>
    <details><summary>Duality GME rules</summary><Markdown source={gme} /></details>
  </section>;
}
