import * as React from 'react';
import type { DualityTable } from '@daggery/shared';

interface Segment { start: number; end: number; text: string }

/** Printed d12 ranges group only consecutive identical entries. */
export function segments(entries: readonly string[]): Segment[] {
  const runs: Segment[] = [];
  entries.forEach((text, index) => {
    const last = runs[runs.length - 1];
    if (last && last.text === text) last.end = index + 1;
    else runs.push({ start: index + 1, end: index + 1, text });
  });
  return runs;
}
export const rangeLabel = ({ start, end }: Segment) => start === end ? `${start}` : `${start}–${end}`;

/** A printed-table view. No roll handler, result state or bookkeeping controls. */
export function ReferenceTableCard({ table }: { table: DualityTable }) {
  const isMeaning = ['action', 'subject', 'descriptor'].includes(table.id);
  return <article className="solo-reference-table" id={`solo-table-${table.id}`}>
    <header>
      <h2>{table.title}</h2>
      <p>{isMeaning ? 'Hope d12 picks the row. Fear odd: A. Fear even: B.' : table.columns.length > 1 ? 'Roll a d12 for each column.' : 'Roll a d12 and read the matching row.'}</p>
    </header>
    {isMeaning ? <table className="solo-table">
      <thead><tr><th scope="col" className="solo-range">Hope</th>{table.columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}</tr></thead>
      <tbody>{Array.from({ length: 12 }, (_, row) => <tr key={row}>
        <th scope="row" className="solo-range">{row + 1}</th>
        {table.columns.map(column => <td key={column.label}>{column.entries[row]}</td>)}
      </tr>)}</tbody>
    </table> : table.columns.map(column => <section className="solo-reference-column" key={column.label}>
      {table.columns.length > 1 && <h3>{column.label}</h3>}
      <table className="solo-table">
        <thead><tr><th scope="col" className="solo-range">d12</th><th scope="col">{column.label}</th></tr></thead>
        <tbody>{segments(column.entries).map(segment => <tr key={segment.start}>
          <th scope="row" className="solo-range">{rangeLabel(segment)}</th><td>{segment.text}</td>
        </tr>)}</tbody>
      </table>
    </section>)}
  </article>;
}
