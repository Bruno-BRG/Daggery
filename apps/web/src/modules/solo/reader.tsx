import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ReaderDocument } from './reader-document';
import { findReaderEntries, READER_ENTRIES, READER_ORACLE_ID, resolveReaderHash } from './reader-model';

/** The phone mounts only the reader—not the desktop dice, log or session state. */
export function MobileReferenceReader() {
  const [indexOpen, setIndexOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusSearch, setFocusSearch] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    let mounted = true;
    const jump = () => {
      const id = resolveReaderHash(window.location.hash);
      // The app uses a nested scroll container. Handle Back and legacy links
      // there directly; reading and navigation do not need an animation frame.
      if (id) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'auto' });
    };
    // Run after the app's initial page-focus effect, even in a background tab.
    queueMicrotask(() => { if (mounted) jump(); });
    window.addEventListener('hashchange', jump);
    return () => {
      mounted = false;
      window.removeEventListener('hashchange', jump);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    if (indexOpen && focusSearch) input.current?.focus({ preventScroll: true });
  }, [indexOpen, focusSearch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      setFocusSearch(true); setIndexOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searching = Boolean(query.trim());
  const entries = searching ? findReaderEntries(query) : READER_ENTRIES.filter(entry => entry.kind === 'table' || entry.id === READER_ORACLE_ID);
  const groups = [...new Set(entries.map(entry => entry.group))];
  const openIndex = (search: boolean) => { setQuery(''); setFocusSearch(search); setIndexOpen(true); };

  return <div className="solo-shell solo-reader">
    <header className="solo-reader-toolbar">
      <button type="button" className="solo-reader-icon" aria-label="Back to campaign" onClick={() => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: 'home' }))}><Icon name="undo" /></button>
      <a className="solo-reader-name" href="#solo-reader-top">Solo reference</a>
      <button type="button" className="solo-reader-index-button" aria-haspopup="dialog" onClick={() => openIndex(false)}><Icon name="book" /><span>Index</span></button>
      <button type="button" className="solo-reader-icon" aria-label="Find in reference" aria-haspopup="dialog" onClick={() => openIndex(true)}><Icon name="search" /></button>
    </header>
    <ReaderDocument />
    <Dialog open={indexOpen} onClose={() => setIndexOpen(false)} title="Reference index" className="solo-reader-index-dialog">
      <label className="solo-reader-find"><Icon name="search" /><input ref={input} type="search" value={query} aria-label="Find in reference" placeholder="Table, move or phrase" onChange={event => setQuery(event.target.value)} /></label>
      {searching && <p className="solo-reader-find-count" role="status">{entries.length} {entries.length === 1 ? 'reference' : 'references'} found</p>}
      <nav className="solo-reader-index" aria-label="Reference contents">
        {groups.map(group => <section key={group}><h3>{group}</h3>
          {entries.filter(entry => entry.group === group).map(entry => <a href={`#${entry.id}`} key={entry.id} onClick={() => setIndexOpen(false)}>{entry.title}</a>)}
        </section>)}
        {!searching && <section><h3>Manual</h3><a href="#solo-reader-moves" onClick={() => setIndexOpen(false)}>Moves reference</a><a href="#solo-reader-rules" onClick={() => setIndexOpen(false)}>Rules reference</a></section>}
        {searching && !entries.length && <p className="solo-reader-no-match">No matches. Try a table name or a word from an entry, such as camp, danger or lost.</p>}
      </nav>
    </Dialog>
  </div>;
}
