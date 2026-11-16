import * as React from 'react';
import {
  DUALITY_ENGINE_VERSION, DUALITY_LIKELIHOODS, IRON_MOVE_GROUPS, IRON_MOVES, IRON_OUTCOME_LABELS, dualityTable,
} from '@daggery/shared';
import { SOLO_SECTIONS } from './reference';
import { MOVE_FLOWS, OUTCOME_ORDER, type Step } from './workflow';
import { ReferenceTableCard } from './table-reference';
import { READER_ORACLE_ID, readerMoveId, readerRuleId, readerSectionId, readerStepTarget } from './reader-model';

function ReferenceLinks({ steps }: { steps: readonly Step[] | undefined }) {
  if (!steps?.length) return null;
  return <div className="solo-reader-links">{steps.map((step, index) => {
    const target = readerStepTarget(step);
    return <a href={`#${target.id}`} key={index}>{target.label}</a>;
  })}</div>;
}

/** Memoized separately from the index: typing and navigation never rebuild the book. */
export const ReaderDocument = React.memo(function ReaderDocument() {
  return <div className="solo-reader-document" id="solo-reader-top">
    <header className="solo-reader-cover"><h1>Duality GME</h1><span>Reference · {DUALITY_ENGINE_VERSION}</span></header>
    <nav className="solo-reader-shortcuts" aria-label="Common references">
      <a href={`#${READER_ORACLE_ID}`}>Oracle</a>
      <a href="#solo-table-iron-price">Pay the Price</a>
      <a href="#solo-reader-section-meaning">Meaning</a>
      <a href="#solo-reader-section-combat">Combat</a>
    </nav>

    <section className="solo-reader-oracle" id={READER_ORACLE_ID} aria-labelledby="solo-reader-oracle-heading">
      <h2 id="solo-reader-oracle-heading">Ask the Oracle</h2>
      <p>Ask a yes or no question. Roll both d12 and add them. Meet the target for yes; below it means no.</p>
      <table className="solo-table"><thead><tr><th scope="col">Likelihood</th><th scope="col">Target</th><th scope="col">Chance</th></tr></thead>
        <tbody>{DUALITY_LIKELIHOODS.map(item => <tr key={item.id}><th scope="row">{item.label}</th><td>{item.target}+</td><td>{item.chance}</td></tr>)}</tbody>
      </table>
      <p><strong>Doubles:</strong> an extreme result or a twist—“yes, and more” or “no, and worse.” Oracle rolls never give Hope or Fear.</p>
    </section>

    {SOLO_SECTIONS.map(section => <section className="solo-reader-chapter" id={readerSectionId(section.id)} key={section.id} aria-labelledby={`${readerSectionId(section.id)}-heading`}>
      <h2 id={`${readerSectionId(section.id)}-heading`}>{section.label}</h2>
      {section.tables.map(id => <ReferenceTableCard table={dualityTable(id)} headingLevel={3} key={id} />)}
    </section>)}

    <section className="solo-reader-chapter" id="solo-reader-moves" aria-labelledby="solo-reader-moves-heading">
      <h2 id="solo-reader-moves-heading">Moves reference</h2>
      {IRON_MOVE_GROUPS.map(group => <section className="solo-reader-move-group" key={group.id}>
        <h3>{group.label}</h3>
        {IRON_MOVES.filter(move => move.group === group.id).map(move => <article className="solo-reader-move" id={readerMoveId(move.id)} key={move.id}>
          <h4>{move.name}</h4>
          <p className="solo-reader-trigger">{move.trigger}</p>
          {move.roll && <p className="solo-reader-roll">{move.roll}</p>}
          {move.text && <p>{move.text}</p>}
          <ReferenceLinks steps={MOVE_FLOWS[move.id]?.tools} />
          <dl className="solo-reader-outcomes">{OUTCOME_ORDER.filter(outcome => move[outcome]).map(outcome => <div key={outcome}>
            <dt>{IRON_OUTCOME_LABELS[outcome]}</dt><dd><p>{move[outcome]}</p><ReferenceLinks steps={MOVE_FLOWS[move.id]?.[outcome]} /></dd>
          </div>)}</dl>
        </article>)}
      </section>)}
    </section>

    <section className="solo-reader-chapter" id="solo-reader-rules" aria-labelledby="solo-reader-rules-heading">
      <h2 id="solo-reader-rules-heading">Rules reference</h2>
      {SOLO_SECTIONS.flatMap(section => section.reference.map((block, index) => <section className="solo-reader-rule" id={readerRuleId(section.id, index)} key={`${section.id}-${index}`}>
        <h3>{block.title}</h3>
        {block.note && <p>{block.note}</p>}
        <dl>{block.rows.map(([term, detail], row) => <div key={row}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
      </section>))}
    </section>
    <footer className="solo-reader-end"><a href="#solo-reader-top">Back to the top</a></footer>
  </div>;
});
