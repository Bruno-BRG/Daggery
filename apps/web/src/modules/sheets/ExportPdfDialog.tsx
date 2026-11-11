import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import type { Sheet } from './types';
import type { PdfOptions } from './exportPdf';
import fontUrl from '../../assets/fonts/NotoSans-Regular.ttf?url';
import templateUrl from '../../assets/pdf/original-character-sheets.pdf?url';
import './exportPdf.css';

export function ExportPdfDialog({ sheet, open, onClose }: { sheet: Sheet; open: boolean; onClose: () => void }) {
  const [options, setOptions] = useState<PdfOptions>({ blank: false, guide: true, references: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const download = async () => {
    setBusy(true); setError(''); setDone(false);
    try {
      const [{ createCharacterPdf, characterPdfFilename }, response, template] = await Promise.all([
        import('./exportPdf'), fetch(fontUrl), fetch(templateUrl),
      ]);
      if (!response.ok) throw new Error('The PDF font could not be loaded. Please try again.');
      if (!template.ok) throw new Error('The original character sheets could not be loaded. Please try again.');
      const bytes = await createCharacterPdf(sheet, options, new Uint8Array(await response.arrayBuffer()), new Uint8Array(await template.arrayBuffer()));
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
    <p className="daggery-dialog-description">Use the original Daggerheart sheet for {sheet.name}’s class, with its original artwork and layout. Added form fields stay editable after download.</p>
    <fieldset disabled={busy} className="sheet-export-options">
      <label className="sheet-export-check"><input type="checkbox" checked={options.guide} onChange={e => setOptions({ ...options, guide: e.target.checked })} /><span>Include the original character guide</span></label>
      <label className="sheet-export-check"><input type="checkbox" checked={options.references} onChange={e => setOptions({ ...options, references: e.target.checked })} /><span>Include class reference sheets (Druid / Ranger / Brawler)</span></label>
      <label className="sheet-export-check"><input type="checkbox" checked={options.blank} onChange={e => setOptions({ ...options, blank: e.target.checked })} /><span>Leave all fields blank</span></label>
    </fieldset>
    <p className="sheet-export-hint">Includes original sheets for all 13 core and Hope & Fear classes. Keep the character guide enabled for tier and level-up options. Original page sizes and printed rules are preserved; extra inventory continues on the same class sheet. Long labels fit down to 7pt, with full values editable. App notes and domain cards are not included. PDF edits do not update your campaign.</p>
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {done && <p role="status">PDF ready. You can edit and save it in a PDF reader.</p>}
    <button type="button" className="sheet-primary" disabled={busy} onClick={download}><Icon name="pdf" />{busy ? 'Preparing PDF…' : 'Download editable PDF'}</button>
  </Dialog>;
}
