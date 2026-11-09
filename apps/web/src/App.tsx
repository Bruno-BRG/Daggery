import { Suspense, useEffect, useRef, useState } from 'react';
import { getRuleset, getGameSystem, type DualityResult, type RollLogEntry } from '@daggery/shared';
import { useRollReplay } from './dice3d';
import { getModules, getSystemUI } from './modules';
import { CampaignSettings } from './CampaignConfiguration';
import { readPreference, savePreference } from './storage';
import { useSyncStatus } from './sync/store';
import { useRollLog } from './useRollLog';
import { getActiveCampaign, type ActiveCampaign } from './campaign-context';
import { Notes, Library } from './CampaignSections';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { Dialog } from './components/Dialog';
import { useMediaQuery } from './useMediaQuery';
import { ErrorBoundary } from './components/ErrorBoundary';

type Page = string;
type Theme = 'light' | 'dark';
const OUTCOME_LABEL: Record<DualityResult['outcome'], string> = { critical: 'Critical', hope: 'With Hope', fear: 'With Fear' };
interface NavigationItem { id: string; label: string; icon: IconName; description: string; primary?: boolean }
function navigationFor(campaign: ActiveCampaign): NavigationItem[] {
  const modules = getModules(campaign.configuration).filter(module => !module.gmOnly || campaign.role === 'gm');
  return [
    { id: 'home', label: 'Overview', icon: 'home', description: 'Your campaign at a glance', primary: true },
    ...modules.filter(module => module.primary),
    { id: 'notes', label: 'Notes', icon: 'note', description: 'Keep track of every twist in the story' },
    { id: 'library', label: 'Library', icon: 'library', description: 'Your campaign images and documents' },
    ...modules.filter(module => !module.primary),
  ];
}

export default function App({ onLeave }: { onLeave: () => void }) {
  const campaign = getActiveCampaign();
  const NAV = navigationFor(campaign);
  const availableNav = NAV;
  const ruleset = getRuleset(campaign.configuration);
  const systemUI = getSystemUI(campaign.configuration);
  const DiceControls = systemUI?.diceTray;
  const DiceSurface = systemUI?.diceOverlay;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [invite, setInvite] = useState('');
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const { status, rolls, sendRoll } = useRollLog();
  const syncStatus = useSyncStatus();
  const [author, setAuthor] = useState(() => readPreference('daggery:name') ?? 'Player');
  const [requestedPage, setPage] = useState<Page>(campaign.configuration.gmController === 'ai' ? 'ai' : 'home');
  const page = NAV.some(item => item.id === requestedPage) ? requestedPage : 'home';
  const [mobileMenu, setMobileMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [diceOpen, setDiceOpen] = useState(false);
  const [diceDocked, setDiceDocked] = useState(true);
  const wide = useMediaQuery('(min-width: 1440px)');
  const mainRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    readPreference('daggery:style-version') === 'owlbear' && readPreference('daggery:theme') === 'light' ? 'light' : 'dark',
  );
  useRollReplay(rolls);
  useEffect(() => {
    const handler = (event: Event) => setSyncError((event as CustomEvent<string>).detail);
    window.addEventListener('daggery:sync-error', handler);
    return () => window.removeEventListener('daggery:sync-error', handler);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreference('daggery:theme', theme);
    savePreference('daggery:style-version', 'owlbear');
  }, [theme]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    setDiceOpen(false);
  }, [wide]);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    mainRef.current?.focus();
  }, [page]);
  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (next === 'campaigns') onLeave();
      else if (NAV.some((item) => item.id === next)) {
        if (!window.dispatchEvent(new Event('daggery:before-navigate', { cancelable: true }))) return;
        setPage(next as Page);
        setDiceOpen(false);
      }
    };
    window.addEventListener('daggery:navigate', handler);
    return () => window.removeEventListener('daggery:navigate', handler);
  }, [onLeave, campaign.role]);
  const Active = getModules(campaign.configuration).find((module) => module.id === page)?.component;
  const online = status === 'open' && syncStatus === 'open';
  const current = NAV.find((item) => item.id === page)!;
  const dockVisible = !!DiceControls && wide && diceDocked && page !== 'map' && page !== 'ai';
  const diceVisible = dockVisible || diceOpen;

  function navigate(next: Page) {
    if (next !== page && !window.dispatchEvent(new Event('daggery:before-navigate', { cancelable: true }))) return;
    setPage(next);
    setMobileMenu(false);
    setSearchOpen(false);
    setQuery('');
    setDiceOpen(false);
  }
  function updateAuthor(value: string) {
    setAuthor(value);
    savePreference('daggery:name', value);
  }
  async function createInvite() {
    setInviting(true);
    setCopied(false);
    try {
      const result = await api<{ token: string }>(`/api/campaigns/${encodeURIComponent(campaign.id)}/invites`, 'POST');
      setInvite(result.token);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not create invite.');
    } finally {
      setInviting(false);
    }
  }
  const navigation = (compact = false) => (
    <nav className="daggery-nav" aria-label={compact ? 'All sections' : 'Main navigation'}>
      {['At the table', 'Your campaign'].map((group, index) => (
        <div className="daggery-nav-group" key={group}>
          <p className="daggery-nav-group-label">{group}</p>
          {availableNav.filter((item) =>
            index === 0 ? item.primary : !item.primary,
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className="daggery-nav-button"
              onClick={() => navigate(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span className="daggery-nav-label">{item.label}</span>
              {page === item.id && <span className="daggery-nav-active-dot" />}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
  if (!ruleset || !systemUI) return <main className="daggery-home"><h1>Game system unavailable</h1><p>This campaign needs its registered system and ruleset to open.</p><button className="daggery-primary" onClick={onLeave}>Back to campaigns</button></main>;
  const dice = (
    <>
      <section aria-label="Roll dice" className="daggery-dice-section">
        <div className="daggery-section-heading">
          <span className="daggery-section-icon">
            <Icon name="dice" />
          </span>
          <div>
            <h2>Dice tray</h2>
            <p>A little chance. A great story.</p>
          </div>
        </div>
        {DiceControls && <DiceControls
          author={author}
          onRolled={(message) => {
            sendRoll(message);
            setDiceOpen(false);
          }}
        />}
      </section>
      <section aria-labelledby="log-heading" className="daggery-history">
        <div className="daggery-history-heading">
          <h2 id="log-heading">Recent rolls</h2>
          <span>{rolls.length}</span>
        </div>
        {rolls.length === 0 ? (
          <div className="daggery-empty-rolls">
            <Icon name="dice" />
            <strong>The dice are waiting.</strong>
            <p>Your table’s rolls will appear here.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {[...rolls].reverse().map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </>
  );

  return (
    <div className={`daggery-shell ${page === 'map' ? 'daggery-shell-table' : ''}`}>
      {DiceSurface && <ErrorBoundary name="Dice display"><DiceSurface /></ErrorBoundary>}
      <a className="daggery-skip" href="#main-content">
        Skip to content
      </a>
      <aside className="daggery-sidebar">
        <div className="daggery-logo">
          <span className="daggery-logo-mark" aria-hidden="true">
            <Icon name="spark" />
          </span>
          <span className="daggery-logo-text">
            daggery<span></span>
          </span>
        </div>
        <button type="button" className="daggery-campaign-switch" onClick={onLeave} title="Switch campaign">
          <span className="daggery-campaign-monogram">{campaign.name.slice(0, 1).toUpperCase()}</span>
          <span className="daggery-campaign-info">
            <strong>{campaign.name}</strong>
            <small>{getGameSystem(campaign.configuration.systemId)?.name ?? 'Unknown system'} · {ruleset?.mode === 'solo' ? 'Solo' : 'Group'}</small>
          </span>
          <Icon name="chevron" />
        </button>
        <button type="button" className="daggery-search" onClick={() => setSearchOpen(true)} aria-label="Find a section">
          <Icon name="search" />
          <span>Quick navigation</span>
          <kbd>Ctrl K</kbd>
        </button>
        {navigation()}
        <div className="daggery-sidebar-footer">
          <button type="button" className="daggery-avatar" onClick={() => setMobileMenu(true)} aria-label="Profile and campaign">
            {author.trim().slice(0, 2).toUpperCase() || 'PL'}
          </button>
          <label className="daggery-profile">
            <input aria-label="Your name" value={author} onChange={(event) => updateAuthor(event.target.value)} maxLength={60} />
            <small>{getRuleset(campaign.configuration)?.mode === 'solo' ? 'Solo player' : campaign.role === 'gm' ? 'Game Master' : 'Player'}</small>
          </label>
          <button
            type="button"
            className="daggery-footer-switch"
            onClick={onLeave}
            title="Switch campaign"
            aria-label="Switch campaign"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="daggery-workspace">
        <header className="daggery-topbar">
          <div className="daggery-breadcrumb">
            <span>{campaign.name}</span>
            <span aria-hidden="true">/</span>
            <strong>{current.label}</strong>
          </div>
          <div className="daggery-top-actions">
            <span
              role="status"
              className={`daggery-connection ${online ? 'is-online' : ''}`}
              title={online ? 'All changes are synced' : 'Waiting for connection'}
            >
              <i aria-hidden="true" />
              <span>{online ? 'Live' : 'Offline'}</span>
            </span>
            {campaign.role === 'gm' && ruleset?.mode !== 'solo' && (
              <button
                type="button"
                className="daggery-invite daggery-roll-toggle"
                disabled={inviting}
                onClick={() => void createInvite()}
                aria-label="Invite players"
              >
                <Icon name="invite" />
                <span>{inviting ? 'Creating…' : 'Invite players'}</span>
              </button>
            )}
            {campaign.role === 'gm' && <button type="button" className="daggery-theme" aria-label="Campaign settings" title="Campaign settings" onClick={() => { if (window.dispatchEvent(new Event('daggery:before-navigate', { cancelable: true }))) setSettingsOpen(true); }}><Icon name="settings" /></button>}
            <button
              type="button"
              className={`daggery-roll-toggle daggery-dice-toggle ${diceVisible ? 'is-active' : ''}`}
              onClick={() => (wide && page !== 'map' && page !== 'ai' ? setDiceDocked((open) => !open) : setDiceOpen((open) => !open))}
              aria-label={diceVisible ? 'Hide dice' : 'Show dice'}
              aria-expanded={diceVisible}
            >
              <Icon name="dice" />
              <span>Dice</span>
            </button>
            <button
              type="button"
              className="daggery-theme"
              onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
              aria-label={theme === 'light' ? 'Enable dark theme' : 'Enable light theme'}
              title={theme === 'light' ? 'Enable dark theme' : 'Enable light theme'}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>
          </div>
        </header>
        {settingsOpen && <CampaignSettings campaign={campaign} onClose={() => setSettingsOpen(false)} onSaved={() => window.location.reload()} />}
        {syncError && (
          <div role="alert" className="daggery-alert">
            <span>{syncError}</span>
            <button type="button" onClick={() => setSyncError('')} aria-label="Dismiss error">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="daggery-content">
          <main id="main-content" ref={mainRef} tabIndex={-1} className={`daggery-main daggery-page-${page}`}>
            {page === 'notes' ? (
              <Notes />
            ) : page === 'library' ? (
              <Library />
            ) : page === 'home' ? (
              <Home onNavigate={navigate} />
            ) : (
              Active && (
                <ErrorBoundary name={current.label} resetKey={page} onBack={() => navigate('home')}><Suspense
                  fallback={
                    <div role="status" className="daggery-loading">
                      <span />
                      Loading {current.label.toLowerCase()}…
                    </div>
                  }
                >
                  <Active author={author} />
                </Suspense></ErrorBoundary>
              )
            )}
          </main>
          {dockVisible && (
            <aside className="daggery-rolls" aria-label="Dice and roll history">
              {dice}
            </aside>
          )}
        </div>
      </div>
      <nav className="daggery-bottom-nav" aria-label="Mobile navigation">
        {NAV.slice(0, 4).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.id)}
            aria-current={page === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.id === 'map' ? 'Table' : item.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMobileMenu(true)}
          aria-expanded={mobileMenu}
          aria-label="More sections"
          className={
            !NAV.slice(0, 4).some((item) => item.id === page) ? 'is-active' : ''
          }
        >
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      <Dialog open={mobileMenu} onClose={() => setMobileMenu(false)} title="Your campaign" className="daggery-menu-dialog">
        <button type="button" className="daggery-campaign-switch" onClick={onLeave}>
          <span className="daggery-campaign-monogram">{campaign.name.slice(0, 1).toUpperCase()}</span>
          <span className="daggery-campaign-info">
            <strong>{campaign.name}</strong>
            <small>Switch campaign</small>
          </span>
          <Icon name="chevron" />
        </button>
        {navigation(true)}
        <label className="daggery-mobile-profile">
          Your name
          <input
            className="daggery-auth-input"
            value={author}
            onChange={(event) => updateAuthor(event.target.value)}
            maxLength={60}
          />
        </label>
        <p className="daggery-menu-role">Playing as {getRuleset(campaign.configuration)?.mode === 'solo' ? 'Solo player' : campaign.role === 'gm' ? 'Game Master' : 'Player'}</p>
      </Dialog>
      <Dialog open={diceOpen} onClose={() => setDiceOpen(false)} title="Dice & history" className="daggery-dice-dialog">
        {dice}
      </Dialog>
      <Dialog
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          setQuery('');
        }}
        title="Quick navigation"
        className="daggery-command-dialog"
      >
        <label className="daggery-command-search">
          <Icon name="search" />
          <input
            data-autofocus
            placeholder="Where would you like to go?"
            aria-label="Search sections"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="daggery-command-results">
          {availableNav.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())).map(
            (item) => (
              <button type="button" key={item.id} onClick={() => navigate(item.id)}>
                <span className="daggery-shortcut-icon">
                  <Icon name={item.icon} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ),
          )}
        </div>
        {!availableNav.some((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())) && (
          <p className="daggery-command-empty">No sections found. Try “characters” or “rules”.</p>
        )}
      </Dialog>
      <Dialog open={!!invite} onClose={() => setInvite('')} title="Invite your party">
        <p className="daggery-dialog-description">
          Share this code with a player. They can join from their campaign screen. Each code works once and expires in 7 days.
        </p>
        <label className="daggery-invite-code">
          Invite code
          <input readOnly value={invite} onFocus={(event) => event.target.select()} />
        </label>
        <button
          type="button"
          className="daggery-primary"
          onClick={() => {
            void navigator.clipboard
              .writeText(invite)
              .then(() => setCopied(true))
              .catch(() => setSyncError('Copy unavailable. Select and copy the invite code manually.'));
          }}
        >
          {copied ? 'Copied!' : 'Copy invite code'}
        </button>
      </Dialog>
    </div>
  );
}

function Home({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const campaign = getActiveCampaign();
  const NAV = navigationFor(campaign);
  const solo = getRuleset(campaign.configuration)?.mode === 'solo';
  const ai = campaign.configuration.gmController === 'ai';
  const main = NAV.find(item => item.id === (campaign.configuration.gmController === 'ai' ? 'ai' : solo ? 'solo' : 'map')) ?? NAV.find(item => item.primary && item.id !== 'home');
  return (
    <div className="daggery-home daggery-overview">
      <div className="daggery-overview-heading">
        <div>
          <p className="daggery-eyebrow">Your campaign workspace</p>
          <h1>{campaign.name}</h1>
          <p>Everything your next session needs.</p>
        </div>
        <span className="daggery-role-badge">
          <span aria-hidden="true">✦</span>
          {getRuleset(campaign.configuration)?.mode === 'solo' ? 'Solo player' : campaign.role === 'gm' ? 'Game Master' : 'Player'}
        </span>
      </div>
      <section className="daggery-table-feature" aria-labelledby="table-title">
        <div className="daggery-table-copy">
          <span className="daggery-feature-eyebrow">
            <Icon name="compass" /> The adventure awaits
          </span>
          <h2 id="table-title">
            {ai ? 'Your next chapter' : solo ? 'Your solo adventure' : main?.id === 'map' ? <>Your world.<br />Your table.</> : main?.label ?? 'Your campaign'}
          </h2>
          <p>{ai ? 'A connected GM, your heroes, and a world shaped by your choices.' : solo ? 'Oracles, scene themes, and your campaign journal.' : main?.description ?? 'Your campaign notes and resources.'}</p>
          <button type="button" className="daggery-primary" onClick={() => onNavigate(main?.id ?? 'notes')}>
            <Icon name={main?.icon ?? 'note'} /> {ai ? 'Continue adventure' : solo ? 'Continue solo play' : `Open ${main?.label.toLowerCase() ?? 'notes'}`}
            <Icon name="arrow" />
          </button>
        </div>
        <div className="daggery-table-art daggery-table-preview" aria-hidden="true">
          <img src="/maps/rocky-forest.png" alt="" />
        </div>
      </section>
      <div className="daggery-section-title">
        <h2>Ready for your next session</h2>
        <span>Your essentials, all in one place</span>
      </div>
      <div className="daggery-shortcuts">
        {NAV.filter((item) => ['sheets', solo ? 'solo' : 'compendium', 'notes'].includes(item.id)).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`daggery-shortcut daggery-essential essential-${item.id}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="daggery-shortcut-top">
              <span className="daggery-shortcut-icon">
                <Icon name={item.icon} />
              </span>
              <Icon name="arrow" />
            </span>
            <strong>{item.label}</strong>
            <small>{item.description}.</small>
            <span className="daggery-shortcut-link">
              {item.id === 'sheets' ? 'Meet your heroes' : item.id === 'notes' ? 'Session notes' : item.id === 'solo' ? 'Continue solo play' : 'Explore the compendium'}
              <Icon name="chevron" />
            </span>
          </button>
        ))}
      </div>
      <div className="daggery-section-title">
        <h2>Keep the story together</h2>
      </div>
      <div className="daggery-story-links">
        {NAV.filter((item) => ['notes', 'library'].includes(item.id) || (item.id === 'gm' && campaign.role === 'gm')).map((item) => (
          <button key={item.id} type="button" className="daggery-shortcut" onClick={() => onNavigate(item.id)}>
            <span className="daggery-shortcut-icon">
              <Icon name={item.icon} />
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}.</small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      <footer className="daggery-home-footer">
        <span aria-hidden="true">✦</span> Made for the stories you tell together.<span>DAGGERHEART</span>
      </footer>
    </div>
  );
}

function LogRow({ entry }: { entry: RollLogEntry }) {
  const at = new Date(entry.at);
  return (
    <li className="daggery-log-row">
      <div className="flex justify-between gap-2 text-xs text-slate-500">
        <span className="truncate font-medium text-slate-400">{entry.author}</span>
        <time dateTime={at.toISOString()} className="shrink-0 tabular-nums">
          {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      {entry.kind === 'duality' ? (
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 tabular-nums">
          <span className="text-xs text-slate-400">
            Hope {entry.result.hope} / Fear {entry.result.fear}{' '}
            <strong className="text-sm text-slate-100">{entry.result.total}</strong>
          </span>
          <span className={`text-xs font-semibold ${entry.result.outcome === 'fear' ? 'text-rose-300' : 'text-emerald-300'}`}>
            {OUTCOME_LABEL[entry.result.outcome]}
          </span>
        </div>
      ) : (
        <div className="mt-1 flex items-baseline justify-between gap-2 tabular-nums">
          <span className="text-xs text-slate-400">{entry.result.notation}</span>
          <strong className="text-slate-100">{entry.result.total}</strong>
        </div>
      )}
    </li>
  );
}
