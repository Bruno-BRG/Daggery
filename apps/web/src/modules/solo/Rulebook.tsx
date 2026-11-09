import { Fragment, type ReactNode } from 'react';
import rules from '../../../../../docs/solo-rules.md?raw';
import themes from '../../../../../docs/solo-themes.md?raw';

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
export function Rulebook() {
  return <section className="solo-rulebook"><p className="solo-muted">Homebrew playtest rules · v0.2. Oracle math is verified; companion and encounter balance need playtesting.</p><details open><summary>Core solo rules</summary><Markdown source={rules.split('## Daggery integration notes')[0]!} /></details><details><summary>Thematic scene pools</summary><Markdown source={themes.split('## Daggery interface notes')[0]!} /></details></section>;
}
