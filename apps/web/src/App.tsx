import { Suspense, useEffect, useRef, useState } from 'react';
import { getRuleset, getGameSystem, type DualityResult, type RollLogEntry } from '@daggery/shared';
import { useRollReplay } from './dice3d';
import { getModules, getSystemUI } from './modules';
import { readPreference, savePreference } from './storage';
import { useSyncStatus } from './sync/store';
import { useRollLog } from './useRollLog';
import { getActiveCampaign, type ActiveCampaign } from './campaign-context';
import { CampaignMenu } from './CampaignMenu';
import { useActiveHeroName } from './modules/sheets/activeHero';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { Dialog } from './components/Dialog';
import { TONES } from './components/Accordion';
import { useMediaQuery } from './useMediaQuery';
import { ErrorBoundary } from './components/ErrorBoundary';

type Page = string;
type Theme = 'light' | 'dark';
const OUTCOME_LABEL: Record<DualityResult['outcome'], string> = { critical: 'Critical', hope: 'With Hope', fear: 'With Fear' };
interface NavigationItem { id: string; label: string; icon: IconName; description: string; primary?: boolean }
function navigationFor(campaign: ActiveCampaign): NavigationItem[] {
  const modules = getModules(campaign.configuration).filter(module => !module.gmOnly || campaign.role === 'gm');
  return modules;
}

export default function App({ onLeave }: { onLeave: () => void }) {
  const campaign = getActiveCampaign();
  // Like Stargazer, the character tab carries your hero's name.
  const heroName = useActiveHeroName();
  const NAV = navigationFor(campaign).map(item => item.id === 'sheets' && heroName ? { ...item, label: heroName } : item);
  const availableNav = NAV;
  const ruleset = getRuleset(campaign.configuration);
  const systemUI = getSystemUI(campaign.configuration);
  const DiceControls = systemUI?.diceTray;
  const DiceSurface = systemUI?.diceOverlay;
  const companion = systemUI?.companion && ruleset?.features.includes(systemUI.companion.feature) && (!systemUI.companion.gmOnly || campaign.role === 'gm') ? systemUI.companion : undefined;
  const Companion = companion?.component;
  const [syncError, setSyncError] = useState('');
  const { status, rolls, sendRoll } = useRollLog();
  const syncStatus = useSyncStatus();
  const [author, setAuthor] = useState(() => readPreference('daggery:name') ?? 'Player');
  const [requestedPage, setPage] = useState<Page>(() => NAV[0]?.id ?? '');
  const page = NAV.some(item => item.id === requestedPage) ? requestedPage : NAV[0]?.id ?? '';
  const [mobileMenu, setMobileMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [diceOpen, setDiceOpen] = useState(false);
  const [diceDocked, setDiceDocked] = useState(true);
  const wide = useMediaQuery('(min-width: 1440px)');
  // Below 1100px the panel slides in over the page instead of sitting beside it.
  const overlay = useMediaQuery('(max-width: 1100px)');
  // Wide screens keep the panel docked (remembered); narrower ones open it over the page on demand.
  const [companionDocked, setCompanionDocked] = useState(() => readPreference('daggery:companion') !== 'closed');
  const [companionSheet, setCompanionSheet] = useState(false);
  const companionOpen = !!Companion && (overlay ? companionSheet : companionDocked);
  const companionBeside = !!Companion && !overlay && companionDocked;
  function setCompanion(open: boolean) {
    if (overlay) { setCompanionSheet(open); return; }
    setCompanionDocked(open);
    savePreference('daggery:companion', open ? 'open' : 'closed');
  }
  useEffect(() => {
    const open = () => setCompanion(true);
    window.addEventListener('daggery:solo-screen', open);
    return () => window.removeEventListener('daggery:solo-screen', open);
  });
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
    // Phones paint the status bar (and the installed app's title bar) in this colour; match the top bar.
    const raised = getComputedStyle(document.documentElement).getPropertyValue('--ds-raised').trim();
    if (raised) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', raised);
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
  // The solo screen takes the right-hand column; the dice then open over the page instead.
  const dockVisible = !!DiceControls && wide && diceDocked && !companionBeside;
  const diceVisible = dockVisible || diceOpen;

  function navigate(next: Page) {
    if (next !== page && !window.dispatchEvent(new Event('daggery:before-navigate', { cancelable: true }))) return;
    setPage(next);
    setMobileMenu(false);
    setSearchOpen(false);
    setQuery('');
    setDiceOpen(false);
    setCompanionSheet(false);
  }
  function updateAuthor(value: string) {
    setAuthor(value);
    savePreference('daggery:name', value);
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
    <div className="daggery-shell">
      {DiceSurface && <ErrorBoundary name="Dice display"><DiceSurface /></ErrorBoundary>}
      <a className="daggery-skip" href="#main-content">
        Skip to content
      </a>
      <div className="daggery-workspace">
        <header className="daggery-topbar">
          <div className="daggery-brand-bar">
            <button type="button" className="daggery-menu-button" onClick={() => setMobileMenu(true)} aria-label="Menu: campaign, profile and every section" aria-expanded={mobileMenu}>
              <Icon name="more" />
            </button>
            <span className="daggery-brand-name">daggery</span>
            <span className="daggery-brand-divider" aria-hidden="true" />
            <button type="button" className="daggery-brand-campaign" onClick={() => setMobileMenu(true)} title="Campaigns">{campaign.name}</button>
            <strong className="daggery-brand-page">{current.label}</strong>
          </div>
          <div className="daggery-top-actions">
            <button type="button" className="daggery-theme" onClick={() => setSearchOpen(true)} aria-label="Quick navigation (Ctrl K)" title="Quick navigation (Ctrl K)"><Icon name="search" /></button>
            <span
              role="status"
              className={`daggery-connection ${online ? 'is-online' : ''}`}
              title={online ? 'All changes are synced' : 'Waiting for connection'}
            >
              <i aria-hidden="true" />
              <span>{online ? 'Live' : 'Offline'}</span>
            </span>
            <button
              type="button"
              className={`daggery-roll-toggle daggery-dice-toggle ${diceVisible ? 'is-active' : ''}`}
              onClick={() => (wide && !companionBeside ? setDiceDocked((open) => !open) : setDiceOpen((open) => !open))}
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
        <nav className="daggery-tabs" aria-label="Main navigation">
          {availableNav.map(item => <button key={item.id} type="button" onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
            {item.label}
          </button>)}
        </nav>
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
            {(
              Active && (
                <ErrorBoundary name={current.label} resetKey={page} onBack={() => navigate(NAV[0]?.id ?? '')}><Suspense
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
          {Companion && overlay && companionOpen && <div className="daggery-companion-backdrop" aria-hidden="true" onClick={() => setCompanion(false)} />}
          {companion && <button type="button" className={`daggery-companion-fab${companionOpen ? ' is-open' : ''}`} onClick={() => setCompanion(!companionOpen)}
            aria-expanded={companionOpen} aria-label={companionOpen ? 'Close oracles, moves and journal' : 'Open oracles, moves and journal'} title={companionOpen ? 'Close the panel' : 'Oracles, moves and journal'}>
            <Icon name="chevron" />
          </button>}
          {Companion && <ErrorBoundary name={companion.label} resetKey="companion" onBack={() => setCompanion(false)}><Suspense fallback={null}>
            <Companion open={companionOpen} onClose={() => setCompanion(false)} />
          </Suspense></ErrorBoundary>}
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
            <span>{item.label}</span>
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
      <Dialog open={mobileMenu} onClose={() => setMobileMenu(false)} title="Daggery" className="daggery-menu-dialog">
        <CampaignMenu author={author} onAuthor={updateAuthor} />
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
