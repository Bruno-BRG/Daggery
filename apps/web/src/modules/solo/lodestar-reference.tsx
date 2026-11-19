import { LODESTAR_GROUPS, LODESTAR_TABLES, type LodestarColumn, type LodestarGroup, type LodestarTable } from '@daggery/shared';

/** A d100 roll prints 100 as 00, as on the dice. */
export const d100Label = (value: number) => (value === 100 ? '00' : String(value));
export const d100Range = (from: number, to: number) => (from === to ? d100Label(from) : `${d100Label(from)}–${d100Label(to)}`);

/** A column of one-wide rows (Action, Theme, names...) prints as a word grid, as in the book. */
const isWordList = (column: LodestarColumn) => column.rows.length >= 50 && column.rows.every(([from, to]) => from === to);

/** True when every column has the same rows, so the table can share one range column. */
function sharesRanges(table: LodestarTable): boolean {
  const [first, ...rest] = table.columns;
  return rest.length > 0 && rest.every(column => column.rows.length === first!.rows.length && column.rows.every((row, index) => row[0] === first!.rows[index]![0] && row[1] === first!.rows[index]![1]));
}

/** A printed d100 table. Nothing here rolls; the dice tray rolls a d100 (two d10, tens and units). */
export function LodestarTableCard({ table, headingLevel = 2 }: { table: LodestarTable; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const ColumnHeading = headingLevel === 3 ? 'h4' : 'h3';
  const first = table.columns[0]!;
  return <article className="solo-reference-table solo-lodestar-table" id={`solo-lodestar-${table.id}`}>
    <header>
      <Heading>{table.title}</Heading>
      <p>{table.intro}</p>
    </header>
    {table.columns.length === 1 && isWordList(first)
      ? <ol className="solo-d100-grid" aria-label={`${table.title}: 1 to 100`}>
        {first.rows.map(([from, , text]) => <li key={from}><b>{d100Label(from)}</b> {text}</li>)}
      </ol>
      : sharesRanges(table)
        ? <table className="solo-table">
          <thead><tr><th scope="col" className="solo-range">d100</th>{table.columns.map(column => <th scope="col" key={column.label}>{column.label}</th>)}</tr></thead>
          <tbody>{first.rows.map(([from, to], index) => <tr key={from}>
            <th scope="row" className="solo-range">{d100Range(from, to)}</th>
            {table.columns.map(column => <td key={column.label}>{column.rows[index]![2]}</td>)}
          </tr>)}</tbody>
        </table>
        : table.columns.map(column => <section className="solo-reference-column" key={column.label}>
          {table.columns.length > 1 && <ColumnHeading>{column.label}</ColumnHeading>}
          <table className="solo-table">
            <thead><tr><th scope="col" className="solo-range">d100</th><th scope="col">{column.label}</th></tr></thead>
            <tbody>{column.rows.map(([from, to, text]) => <tr key={from}><th scope="row" className="solo-range">{d100Range(from, to)}</th><td>{text}</td></tr>)}</tbody>
          </table>
        </section>)}
  </article>;
}

export const lodestarTablesIn = (group: LodestarGroup) => LODESTAR_TABLES.filter(table => table.group === group);
export { LODESTAR_GROUPS };
