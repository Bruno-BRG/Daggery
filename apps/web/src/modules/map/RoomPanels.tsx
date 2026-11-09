import { lazy, Suspense, useEffect, useState } from 'react';
import { DiceTray } from '../../dice3d';
import { useRollLog } from '../../useRollLog';
import { getActiveCampaign } from '../../campaign-context';
import { api } from '../../api';
import { uploadAsset } from '../../sync/store';
import { RoomIcon } from './RoomIcon';
import type { AdversarySource } from '../combat/model';

const Combat = lazy(() => import('../combat'));
const PdfReader = lazy(() => import('./PdfReader'));
export type RoomPanel = 'room' | 'players' | 'dice' | 'combat' | 'pdf' | 'scenes' | 'miniatures';
export const navigateRoom = (page: string) => window.dispatchEvent(new CustomEvent('daggery:navigate', { detail: page }));
const base = () => `/api/campaigns/${encodeURIComponent(getActiveCampaign().id)}`;
interface Member {
  id: string;
  username: string;
  role: 'gm' | 'player';
}
export interface RoomAsset {
  id: string;
  name: string;
  mediaType: string;
  size: number;
}

export function RoomHome({ onScenes, onSettings }: { onScenes: () => void; onSettings: () => void }) {
  return (
    <div className="room-menu-list">
      <p>{getActiveCampaign().name}</p>
      <button onClick={onScenes}>
        <RoomIcon name="maps" /> Scenes
      </button>
      <button onClick={onSettings}>
        <RoomIcon name="settings" /> Scene settings
      </button>
      <button onClick={() => navigateRoom('sheets')}>
        <RoomIcon name="players" /> Character sheets
      </button>
      <button onClick={() => navigateRoom('compendium')}>
        <RoomIcon name="library" /> Rules & compendium
      </button>
      <button onClick={() => navigateRoom('home')}>
        <RoomIcon name="home" /> Campaign overview
      </button>
      <button onClick={() => navigateRoom('campaigns')}>
        <RoomIcon name="external" /> Switch campaign
      </button>
    </div>
  );
}

export function RoomPlayers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState('');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([api<{ members: Member[] }>(`${base()}/members`), api<{ user: Member }>('/api/me')])
      .then(([result, current]) => {
        if (active) {
          setMembers(result.members);
          setMe(current.user.id);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="room-players">
      <p className="room-muted">Campaign members · {members.length}</p>
      {members.map((member, index) => (
        <div key={member.id} className="room-player">
          <i style={{ background: ['#f5d34e', '#ad8ff6', '#69c9bd', '#ef9a7a'][index % 4] }} />
          <span>
            {member.username}
            {member.id === me && <small> (you)</small>}
          </span>
          <b>{member.role === 'gm' ? 'GM' : 'Player'}</b>
        </div>
      ))}
      {getActiveCampaign().role === 'gm' && (
        <button
          className="room-action"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api<{ token: string }>(`${base()}/invites`, 'POST')
              .then((r) => setInvite(r.token))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <RoomIcon name="plus" size={16} />
          {busy ? 'Creating…' : 'Create player invite'}
        </button>
      )}
      {invite && (
        <label className="room-invite">
          Single-use invite · expires in 7 days
          <input aria-label="Player invite code" readOnly value={invite} onFocus={(e) => e.target.select()} />
          <small>Select and copy this code for your player.</small>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function RoomDice({ author }: { author: string }) {
  const { rolls, sendRoll, status } = useRollLog();
  return (
    <div className="room-dice">
      <DiceTray author={author} onRolled={sendRoll} />
      <div className="room-roll-heading">
        <strong>Recent rolls</strong>
        <span>{status === 'open' ? 'Synced' : 'Connecting…'}</span>
      </div>
      {!rolls.length && <p className="room-muted">Your table’s rolls will appear here.</p>}
      <ol className="room-roll-log">
        {[...rolls]
          .reverse()
          .slice(0, 15)
          .map((roll) => (
            <li key={roll.id}>
              <span>
                {roll.author}
                <small>
                  {roll.kind === 'duality' ? `Hope ${roll.result.hope} · Fear ${roll.result.fear}` : roll.result.notation}
                </small>
              </span>
              <strong>{roll.result.total}</strong>
            </li>
          ))}
      </ol>
    </div>
  );
}

export function RoomCombat({
  author,
  sceneId,
  onPlace,
}: {
  author: string;
  sceneId?: string;
  onPlace?: (id: string, source: AdversarySource) => void;
}) {
  return (
    <Suspense fallback={<p className="room-muted">Loading encounter…</p>}>
      <Combat author={author} sceneId={sceneId} onPlace={onPlace} />
    </Suspense>
  );
}

export function RoomPdfs() {
  const [files, setFiles] = useState<RoomAsset[]>([]);
  const [selected, setSelected] = useState<RoomAsset | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    api<{ assets: RoomAsset[] }>(`${base()}/assets`).then((result) =>
      setFiles(result.assets.filter((asset) => asset.mediaType === 'application/pdf')),
    );
  useEffect(() => {
    if (getActiveCampaign().role === 'gm') void refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="room-pdfs">
      {getActiveCampaign().role !== 'gm' ? (
        <p className="room-muted">Campaign files are currently available to the Game Master.</p>
      ) : (
        <>
          <label className="room-action room-upload">
            <RoomIcon name="upload" size={17} />
            {busy ? 'Uploading…' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                void uploadAsset(file)
                  .then(refresh)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
          {!files.length && (
            <div className="room-panel-empty">
              <RoomIcon name="pdf" size={32} />
              <strong>Your references, within reach.</strong>
              <p>Upload a PDF to read it beside your map.</p>
            </div>
          )}
          {files.map((file) => (
            <button key={file.id} className="room-file" aria-pressed={selected?.id === file.id} onClick={() => setSelected(file)}>
              <RoomIcon name="pdf" />
              <span>
                {file.name}
                <small>{(file.size / 1048576).toFixed(1)} MB</small>
              </span>
            </button>
          ))}
          {selected && (
            <div className="room-pdf-reader">
              <a href={`${base()}/assets/${encodeURIComponent(selected.id)}?inline=1`} target="_blank" rel="noreferrer">
                Open {selected.name}
                <RoomIcon name="external" size={16} />
              </a>
              <Suspense fallback={<p className="room-muted">Opening PDF reader…</p>}><PdfReader key={selected.id} name={selected.name} url={`${base()}/assets/${encodeURIComponent(selected.id)}?inline=1`} /></Suspense>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
