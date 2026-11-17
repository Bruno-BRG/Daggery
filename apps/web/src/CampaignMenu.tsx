import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { getActiveCampaign, type ActiveCampaign } from './campaign-context';
import { CampaignSettings, partyLabel, SOLO_CONFIGURATION } from './CampaignConfiguration';
import { Group, IconButton, PanelSection, Row } from './components/Accordion';
import { Icon } from './components/Icon';
import './campaignMenu.css';

type Campaign = ActiveCampaign & { description: string; archivedAt: string | null };

/** The campaign the app opens straight into, remembered across visits like Stargazer. */
export const LAST_CAMPAIGN_KEY = 'daggery:campaign';
export function openCampaign(id: string) {
  try { localStorage.setItem(LAST_CAMPAIGN_KEY, id); } catch { /* storage blocked */ }
  window.location.reload();
}

/**
 * The ⋯ drawer, after Stargazer's: this campaign's settings, every other campaign, a new
 * campaign, export and import, your name and sign out. There is no separate campaign page.
 */
export function CampaignMenu({ author, onAuthor }: { author: string; onAuthor: (value: string) => void }) {
  const current = getActiveCampaign();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => { setCampaigns((await api<{ campaigns: Campaign[] }>('/api/campaigns')).campaigns); }, []);
  useEffect(() => { void refresh().catch(() => setError('Could not load your campaigns.')); }, [refresh]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.');

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ campaign?: { id: string }; id?: string }>('/api/campaigns', 'POST', { name, description: '', configuration: SOLO_CONFIGURATION });
      const id = result.campaign?.id ?? result.id;
      if (id) openCampaign(id); else { setName(''); await refresh(); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function importFile(chosen: File) {
    setBusy(true); setError('');
    try {
      if (chosen.size > 10 * 1024 * 1024) throw new Error('That file is too large to be a Daggery campaign.');
      const data = JSON.parse(await chosen.text()) as unknown;
      const result = await api<{ campaign: { id: string } }>('/api/campaigns/import', 'POST', data);
      openCampaign(result.campaign.id);
    } catch (e) { fail(e instanceof SyntaxError ? new Error('That is not a Daggery campaign file.') : e); } finally { setBusy(false); }
  }
  async function archive(campaign: Campaign, archived: boolean) {
    try { await api(`/api/campaigns/${campaign.id}`, 'PATCH', { name: campaign.name, description: campaign.description, archived }); await refresh(); } catch (e) { fail(e); }
  }
  async function remove(campaign: Campaign) {
    if (!window.confirm(`Delete "${campaign.name}" forever? Characters, notes and uploads are removed. This cannot be undone.`)) return;
    try { await api(`/api/campaigns/${campaign.id}`, 'DELETE'); await refresh(); } catch (e) { fail(e); }
  }
  async function signOut() {
    try { await api('/api/logout', 'POST'); localStorage.removeItem(LAST_CAMPAIGN_KEY); window.location.reload(); } catch (e) { fail(e); }
  }

  const others = campaigns.filter(c => c.id !== current.id && !c.archivedAt);
  const archived = campaigns.filter(c => c.archivedAt);
  const self = campaigns.find(c => c.id === current.id);

  return <div className="campaign-menu">
    <PanelSection title="This campaign" storageKey="menu.current">
      <Row label={partyLabel(current.configuration)} value={current.name}
        action={<IconButton icon="settings" label="Campaign settings" onClick={() => setSettings(true)} />} />
      <div className="campaign-menu-actions">
        <a className="daggery-roll-toggle" href={`/api/campaigns/${encodeURIComponent(current.id)}/export`} download><Icon name="copy" />Export campaign</a>
        {self && <button type="button" className="daggery-roll-toggle" onClick={() => { if (window.confirm(`Archive "${current.name}"? You can restore it from this menu.`)) void archive(self, true).then(() => { localStorage.removeItem(LAST_CAMPAIGN_KEY); window.location.reload(); }); }}><Icon name="lock" />Archive</button>}
      </div>
    </PanelSection>

    <PanelSection title="Campaigns" storageKey="menu.campaigns">
      {others.length === 0 ? <p className="sg-empty">No other campaigns yet.</p>
        : others.map(c => <Row key={c.id} label={partyLabel(c.configuration)} value={c.name}
          action={<IconButton icon="arrow" tone="action" label={`Open ${c.name}`} onClick={() => openCampaign(c.id)} />} />)}
      <form className="campaign-menu-new" onSubmit={create}>
        <input aria-label="New campaign name" placeholder="New campaign name" value={name} maxLength={100} required onChange={event => setName(event.target.value)} />
        <button className="daggery-primary" type="submit" disabled={busy}>Begin</button>
      </form>
      <button type="button" className="daggery-roll-toggle campaign-menu-import" disabled={busy} onClick={() => file.current?.click()}><Icon name="upload" />Import a campaign file</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void importFile(chosen); }} />
      {archived.length > 0 && <Group title="Archived" icon="lock" count={archived.length}>
        {archived.map(c => <Row key={c.id} label="Archived" value={c.name}
          action={<span className="campaign-menu-row-actions">
            <IconButton icon="undo" label={`Restore ${c.name}`} onClick={() => void archive(c, false)} />
            <IconButton icon="trash" tone="danger" label={`Delete ${c.name}`} onClick={() => void remove(c)} />
          </span>} />)}
      </Group>}
    </PanelSection>

    <PanelSection title="You" storageKey="menu.you">
      <label className="campaign-menu-field">Your name<input value={author} maxLength={60} onChange={event => onAuthor(event.target.value)} /></label>
      <button type="button" className="daggery-roll-toggle" onClick={() => void signOut()}><Icon name="logout" />Sign out</button>
    </PanelSection>

    {error && <p role="alert" className="campaign-menu-error">{error}</p>}
    {settings && <CampaignSettings campaign={self ?? { ...current, description: current.description ?? '' }} onClose={() => setSettings(false)} onSaved={() => window.location.reload()} />}
  </div>;
}
