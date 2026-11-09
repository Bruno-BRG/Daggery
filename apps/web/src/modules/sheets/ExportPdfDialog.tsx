import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import type { Sheet } from './types';
import type { PdfOptions } from './exportPdf';
import fontUrl from '../../assets/fonts/NotoSans-Regular.ttf?url';
import './exportPdf.css';

export function ExportPdfDialog({ sheet, open, onClose }: { sheet: Sheet; open: boolean; onClose: () => void }) {
  const [options, setOptions] = useState<PdfOptions>({ paper: 'a4', story: true, abilities: true, blank: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const download = async () => {
    setBusy(true); setError(''); setDone(false);
    try {
      const [{ createCharacterPdf, characterPdfFilename }, response] = await Promise.all([
        import('./exportPdf'), fetch(fontUrl),
      ]);
      if (!response.ok) throw new Error('The PDF font could not be loaded. Please try again.');
      const bytes = await createCharacterPdf(sheet, options, new Uint8Array(await response.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url; link.download = characterPdfFilename(options.blank ? 'blank' : sheet.name);
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export the PDF. Please try again.');
    } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title="Export character PDF" className="sheet-export-dialog">
    <p className="daggery-dialog-description">Download {sheet.name} as a fillable sheet. Open it in a PDF reader to change fields and save your edits.</p>
    <fieldset disabled={busy} className="sheet-export-options">
      <label>Paper size<select value={options.paper} onChange={e => setOptions({ ...options, paper: e.target.value as PdfOptions['paper'] })}><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
      <label className="sheet-export-check"><input type="checkbox" checked={options.abilities} onChange={e => setOptions({ ...options, abilities: e.target.checked })} /><span>Include features and domain cards</span></label>
      <label className="sheet-export-check"><input type="checkbox" checked={options.story} onChange={e => setOptions({ ...options, story: e.target.checked })} /><span>Include background, connections, and notes</span></label>
      <label className="sheet-export-check"><input type="checkbox" checked={options.blank} onChange={e => setOptions({ ...options, blank: e.target.checked })} /><span>Leave all fields blank</span></label>
    </fieldset>
    <p className="sheet-export-hint">Character stats and equipment are always included. Long entries continue on extra pages. PDF edits stay in the downloaded file and do not update your campaign.</p>
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {done && <p role="status">PDF ready. You can edit and save it in a PDF reader.</p>}
    <button type="button" className="sheet-primary" disabled={busy} onClick={download}><Icon name="pdf" />{busy ? 'Preparing PDF…' : 'Download editable PDF'}</button>
  </Dialog>;
}
