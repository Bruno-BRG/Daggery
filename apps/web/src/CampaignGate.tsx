import { useCallback, useEffect, useState, type FormEvent } from 'react';
import App from './App';
import { setActiveCampaign, type ActiveCampaign } from './campaign-context';
import { api } from './api';
import { AuthPanel, LinkEmail } from './EmailLogin';
import { Icon } from './components/Icon';
import { DEFAULT_CONFIGURATION, getRuleset, type CampaignConfiguration } from '@daggery/shared';
import { CampaignSettings, ConfigurationFields } from './CampaignConfiguration';

type User = { id: string; username: string };
type Campaign = ActiveCampaign & { description: string; archivedAt: string | null };
const input = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100';
const button = 'daggery-roll-toggle';

export default function CampaignGate() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<Campaign | null>(null);
  const [name, setName] = useState('');
  const [configuration, setConfiguration] = useState<CampaignConfiguration>(DEFAULT_CONFIGURATION);
  const [settings, setSettings] = useState<Campaign | null>(null);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const refresh = useCallback(async () => {
    const result = await api<{ campaigns: Campaign[] }>('/api/campaigns');
    setCampaigns(result.campaigns);
    return result.campaigns;
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api<{ user: User | null }>('/api/me');
        if (cancelled) return;
        setUser(result.user);
        if (result.user) {
          const list = await refresh();
          const selected = list.find(c => c.id === sessionStorage.getItem('daggery:campaign') && !c.archivedAt);
          if (selected && !cancelled) { setActiveCampaign(selected); setActive(selected); }
        }
      } catch { if (!cancelled) setError('Server unavailable. Check that Daggery is running.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [refresh]);
  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy('create');
    try { await api('/api/campaigns', 'POST', { name, description: '', configuration }); setName(''); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create campaign.'); }
    finally { setBusy(null); }
  }
  async function accept(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy('join');
    try { await api('/api/invites/accept', 'POST', { token: invite.trim() }); setInvite(''); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not accept invite.'); }
    finally { setBusy(null); }
  }
  function enter(campaign: Campaign) {
    sessionStorage.setItem('daggery:campaign', campaign.id);
    setActiveCampaign(campaign); setActive(campaign);
  }
  async function update(campaign: Campaign, archived: boolean, nextName = campaign.name) {
    try { await api(`/api/campaigns/${campaign.id}`, 'PATCH', { name: nextName, description: campaign.description, archived }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update campaign.'); }
  }
  async function logout() {
    try { await api('/api/logout', 'POST'); sessionStorage.removeItem('daggery:campaign'); setActiveCampaign(null); window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out.'); }
  }
  if (loading) return <main className="daggery-home"><p>Loading…</p></main>;
  if (active) return <App onLeave={() => { sessionStorage.removeItem('daggery:campaign'); window.location.reload(); }} />;
  if (!user) return <AuthPanel initialError={error} onLogin={async loggedIn => { await refresh(); setUser(loggedIn); }} />;
  const visible = campaigns.filter(c => !!c.archivedAt === showArchived && c.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <main className="daggery-home daggery-campaigns">
    <div className="daggery-campaigns-brand"><div className="daggery-logo"><span className="daggery-logo-mark" aria-hidden="true">✦</span> daggery</div><button className={button} onClick={() => void logout()}>Sign out</button></div>
    <>
      <div className="daggery-campaigns-intro"><p className="daggery-eyebrow">Welcome back, {user.username}</p><h1>Every campaign is a new story.</h1><p>Pick up where you left off, or start something unforgettable.</p></div>
      <div className="daggery-campaign-forms">
        <form onSubmit={create} className="daggery-home-feature"><span className="daggery-shortcut-icon"><Icon name="compass" /></span><h2>Start an adventure</h2><p>Create a workspace for your party and your next story.</p><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" className={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. The Ashen Wilds" maxLength={100} required /><ConfigurationFields value={configuration} onChange={setConfiguration} /><button className="daggery-primary" type="submit" disabled={busy !== null}>{busy === 'create' ? 'Creating…' : '+ Create campaign'}</button></form>
        <form onSubmit={accept} className="daggery-home-feature"><span className="daggery-shortcut-icon"><Icon name="invite" /></span><h2>Join your party</h2><p>An invitation is all it takes. Your adventure awaits.</p><label htmlFor="invite">Invite code</label><input id="invite" className={input} value={invite} onChange={e => setInvite(e.target.value)} placeholder="Paste your invite code" required /><button className={button} type="submit" disabled={busy !== null}>{busy === 'join' ? 'Joining…' : 'Join campaign'}</button></form>
      </div>
      <div className="daggery-campaign-list-header"><h2>Your campaigns</h2><input className={input} aria-label="Search campaigns" placeholder="Find a campaign…" value={search} onChange={e => setSearch(e.target.value)} /><button className={button} aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? 'Show active' : 'Show archived'}</button></div>
      {visible.length === 0 ? <div className="daggery-empty-state"><Icon name="book" /><strong>{search ? 'No matching campaigns.' : showArchived ? 'No archived adventures.' : 'Your next story starts here.'}</strong><p>{search ? 'Try a different name.' : showArchived ? 'Archived campaigns will appear here.' : 'Create a campaign or join your party with an invite.'}</p></div> : <div className="daggery-campaign-grid">{visible.map(c => <section key={c.id} className="daggery-campaign-card"><div className="daggery-campaign-card-heading"><span className="daggery-campaign-monogram">{c.name.slice(0, 1).toUpperCase()}</span><span className="daggery-role-badge">{getRuleset(c.configuration)?.mode === 'solo' ? 'Solo player' : c.role === 'gm' ? 'Game Master' : 'Player'}{c.archivedAt ? ' · Archived' : ''}</span></div><h2>{c.name}</h2><span className="campaign-rule-label">{getRuleset(c.configuration)?.name ?? 'Unavailable system'}{getRuleset(c.configuration)?.mode === 'solo' ? ` · ${c.configuration.options.partyMode === 'party' ? 'Small party' : c.configuration.options.partyMode === 'companion' ? 'Hero + companion' : 'Lone hero'}` : ''}</span><p>{c.description || 'A Daggerheart adventure, told together.'}</p><div className="daggery-campaign-card-actions">{!c.archivedAt && <button className="daggery-primary" onClick={() => enter(c)}>Open campaign<Icon name="arrow" /></button>}{c.role === 'gm' && <><button className={button} onClick={() => setSettings(c)}>Settings</button><button className={button} onClick={() => { if (c.archivedAt || window.confirm('Archive this campaign?')) void update(c, !c.archivedAt); }}>{c.archivedAt ? 'Restore' : 'Archive'}</button></>}</div></section>)}</div>}
      <LinkEmail />
      {settings && <CampaignSettings campaign={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); void refresh(); }} />}
    </>
    {error && <p role="alert" className="mt-4 text-rose-300">{error}</p>}
  </main>;
}
