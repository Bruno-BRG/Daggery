import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { getActiveCampaign } from '../../campaign-context';
import type { Sheet } from './types';
import { CHARACTER_IMAGE_SLOTS, bannerImage, portraitImage, tokenImage, prepareCharacterImage, validateCharacterImage, type CharacterImageSlot } from './appearance';
import './appearance.css';

export function CharacterImagesDialog({ sheet, open, onClose, onChange, connected }: {
  sheet: Sheet; open: boolean; onClose: () => void; onChange: (patch: Partial<Sheet>) => void; connected: boolean;
}) {
  const [pending, setPending] = useState<{ slot: CharacterImageSlot; file: File; url: string } | null>(null);
  const [focusX, setFocusX] = useState(50), [focusY, setFocusY] = useState(50);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { const url = pending?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [pending?.url]);
  const close = () => { if (!busy) { setPending(null); setError(''); setMessage(''); onClose(); } };
  const choose = (slot: CharacterImageSlot, file?: File) => {
    if (!file) return;
    setError(''); setMessage('');
    try { validateCharacterImage(file); setFocusX(50); setFocusY(50); setPending({ slot, file, url: URL.createObjectURL(file) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this image.'); }
  };
  const save = async () => {
    if (!pending || !connected) return;
    setBusy(true); setError('');
    try {
      const file = await prepareCharacterImage(pending.file, pending.slot, focusX, focusY);
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}/character-images`, { method: 'POST', body });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Could not upload this image. Please try again.');
      }
      const result = await response.json() as { url: string };
      onChange({ [pending.slot]: result.url });
      setMessage('Character image saved.'); setPending(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this image.'); }
    finally { setBusy(false); }
  };
  const images = { portraitUrl: portraitImage(sheet), bannerUrl: bannerImage(sheet), tokenUrl: tokenImage(sheet) };
  const selected = CHARACTER_IMAGE_SLOTS.find(s => s.key === pending?.slot);
  return <Dialog open={open} onClose={close} title="Character images" className="character-images-dialog">
    <p className="daggery-dialog-description">Give {sheet.name} a portrait, a sheet banner, and a separate table token. Images are shared with your campaign.</p>
    {!connected && <p role="status">Reconnect to the campaign to save images.</p>}
    {pending && selected ? <section className="character-crop">
      <h3>Frame your {selected.title.toLowerCase()}</h3>
      <div className={`character-image-preview ${pending.slot === 'tokenUrl' ? 'is-token' : ''}`} style={{ aspectRatio: selected.aspect, maxWidth: selected.aspect === 1 ? 380 : undefined }}><img src={pending.url} alt="Selected image crop" style={{ objectPosition: `${focusX}% ${focusY}%` }} /></div>
      <label>Horizontal position<input type="range" min="0" max="100" value={focusX} disabled={busy} onChange={e => setFocusX(Number(e.target.value))} /></label>
      <label>Vertical position<input type="range" min="0" max="100" value={focusY} disabled={busy} onChange={e => setFocusY(Number(e.target.value))} /></label>
      <div className="character-image-actions"><button type="button" className="sheet-primary" disabled={busy || !connected} onClick={save}>{busy ? 'Saving image…' : 'Save image'}</button><button type="button" className="sheet-ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
    </section> : <div className="character-image-slots">{CHARACTER_IMAGE_SLOTS.map(slot => <section key={slot.key}>
      <h3>{slot.title}</h3>
      <div className={`character-image-preview ${slot.key === 'tokenUrl' ? 'is-token' : ''}`} style={{ aspectRatio: slot.aspect }}>{images[slot.key] ? <img src={images[slot.key]} alt={`${slot.title} preview`} /> : <Icon name="image" />}</div>
      <div className="character-image-actions"><label className={`sheet-ghost character-upload ${!connected ? 'is-disabled' : ''}`}><Icon name="upload" />{sheet[slot.key] ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!connected} aria-label={`Upload ${slot.title.toLowerCase()}`} onChange={e => { choose(slot.key, e.target.files?.[0]); e.target.value = ''; }} /></label>
        {sheet[slot.key] && <button type="button" className="sheet-ghost" disabled={!connected} onClick={() => { try { onChange({ [slot.key]: undefined }); setMessage(`${slot.title} removed.`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove image.'); } }}>Remove</button>}
      </div>
    </section>)}</div>}
    <p className="character-image-help">PNG, JPEG, or WebP, up to 10 MB. Choose the framing before saving. Tokens use your portrait until you upload a separate image.</p>
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {message && <p role="status">{message}</p>}
  </Dialog>;
}
