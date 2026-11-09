import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { getActiveCampaign } from '../../campaign-context';
import type { Pool } from '@daggery/shared';
import { uploadAsset } from '../../sync/store';
import { BANDS, BOARD_STYLES, CONDITION_PRESETS, TOKEN_COLORS, type MapScene, type MapToken, type BoardStyle } from './model';

export const INPUT = 'w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100';
export const BUTTON =
  'rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40';
const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

function AssetPicker({ onSelect }: { onSelect(url: string): void }) {
  const [assets, setAssets] = useState<{ id: string; name: string; mediaType: string }[]>([]);
  const campaign = getActiveCampaign();
  useEffect(() => {
    let alive = true;
    void api<{ assets: { id: string; name: string; mediaType: string }[] }>(`/api/campaigns/${encodeURIComponent(campaign.id)}/assets`)
      .then(result => { if (alive) setAssets(result.assets.filter(asset => asset.mediaType.startsWith('image/'))); })
      .catch(() => { if (alive) setAssets([]); });
    return () => { alive = false; };
  }, [campaign.id]);
  return <select aria-label="Select image from library" className={INPUT} value="" onChange={event => { if (event.target.value) onSelect(`/api/campaigns/${encodeURIComponent(campaign.id)}/assets/${encodeURIComponent(event.target.value)}`); }}><option value="">Choose from library…</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min = 0,
  step = 1,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className={INPUT}
      value={value}
      min={min}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function PoolField({ label, pool, onChange, lockedMax = false }: { label: string; pool: Pool | undefined; onChange(p: Pool): void; lockedMax?: boolean }) {
  const current = pool?.current ?? 0;
  const max = pool?.max ?? 0;
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-400">
      <span>{label} (current / max; max 0 hides the bar)</span>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput value={current} ariaLabel={`${label} current`} onChange={(v) => onChange({ current: Math.min(v, max), max })} />
        <NumberInput value={max} ariaLabel={`${label} maximum`} disabled={lockedMax} onChange={(v) => onChange({ current: Math.min(current, v), max: v })} />
      </div>
    </div>
  );
}

export function TokenEditor({
  token,
  gm,
  linked = false,
  onPatch,
  onRotate,
  onDuplicate,
  onDelete,
}: {
  token: MapToken;
  gm: boolean;
  linked?: boolean;
  onPatch(patch: Partial<MapToken>): void;
  onRotate(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const has = (c: string) => token.conditions.includes(c);
  const toggle = (c: string) =>
    onPatch({ conditions: has(c) ? token.conditions.filter((x) => x !== c) : [...token.conditions, c] });
  const customConditions = token.conditions.filter((c) => !(CONDITION_PRESETS as readonly string[]).includes(c));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <h2 className={SECTION_TITLE}>Token</h2>
      <Field label="Name">
        <input className={INPUT} value={token.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Size">
          <select
            className={INPUT}
            value={token.size}
            disabled={!gm}
            onChange={(e) => onPatch({ size: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}x{n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Color (no image)">
          <div className="flex flex-wrap items-center gap-1">
            {TOKEN_COLORS.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={`Miniature color ${c}`}
                className={`h-5 w-5 rounded-full border ${token.color === c ? 'border-white' : 'border-slate-700'}`}
                style={{ background: c }}
                onClick={() => onPatch({ color: c })}
              />
            ))}
          </div>
        </Field>
      </div>

      <div className="flex flex-col gap-1 text-xs text-slate-400">
        <span>Image</span>
        <div className="flex items-center gap-2">
          <label className={`${BUTTON} cursor-pointer`}>
            {token.image ? 'Replace' : 'Upload'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  onPatch({ image: await uploadAsset(file) });
                  setError(null);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Upload failed');
                }
              }}
            />
          </label>
          <AssetPicker onSelect={url => onPatch({ image: url })} />
          {token.image && (
            <button className={BUTTON} onClick={() => onPatch({ image: '' })}>
              Remove
            </button>
          )}
        </div>
        {error && <span className="text-rose-400">{error}</span>}
      </div>

      {(linked || token.combatRefId) && <p className="vtt-linked-note">{token.combatRefId ? 'Linked encounter · HP, Stress, and conditions update the combat tracker.' : 'Linked character · HP and Stress update the character sheet.'}</p>}
      <PoolField label="HP" pool={token.hp} lockedMax={linked || !!token.combatRefId} onChange={(hp) => onPatch({ hp })} />
      <PoolField label="Stress" pool={token.stress} lockedMax={linked || !!token.combatRefId} onChange={(stress) => onPatch({ stress })} />

      <div className="flex flex-col gap-1 text-xs text-slate-400">
        <span>Conditions</span>
        <div className="flex flex-wrap gap-1">
          {CONDITION_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => toggle(c)}
              aria-pressed={has(c)}
              className={`rounded-full border px-2 py-0.5 text-xs ${has(c) ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-slate-700 text-slate-400'}`}
            >
              {c}
            </button>
          ))}
          {customConditions.map((c) => (
            <button
              key={c}
              onClick={() => toggle(c)}
              title="Remove"
              className="rounded-full border border-sky-400 bg-sky-500/20 px-2 py-0.5 text-xs text-sky-100"
            >
              {c} x
            </button>
          ))}
        </div>
        <input
          className={INPUT}
          placeholder="Other condition (Enter)"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            const value = custom.trim();
            if (e.key === 'Enter' && value && !has(value)) {
              onPatch({ conditions: [...token.conditions, value] });
              setCustom('');
            }
          }}
        />
      </div>

      {gm && (
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={token.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} />
          Hidden from players
        </label>
      )}
      {gm && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={!!token.locked} onChange={event => onPatch({ locked: event.target.checked })} />Lock miniature position</label>}

      <div className="flex flex-wrap gap-2">
        <button className={BUTTON} onClick={onRotate} title="Rotate 90 degrees (R)">
          Rotate 90
        </button>
        {gm && (
          <>
            <button className={BUTTON} onClick={onDuplicate} title="Duplicate (D)">
              Duplicate
            </button>
            <button
              className={`${BUTTON} hover:text-rose-300`}
              onClick={() => {
                if (window.confirm(`Remove the token "${token.name}"?`)) onDelete();
              }}
              title="Remove (Delete)"
            >
              Remove
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function SceneSettings({ scene, onPatch }: { scene: MapScene; onPatch(patch: Partial<MapScene>): void }) {
  const [error, setError] = useState<string | null>(null);
  const hasMap = !!scene.mapUrl;

  const uploadMap = async (file: File) => {
    try {
      const url = await uploadAsset(file);
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      onPatch({ mapUrl: url, mapWidth: width, mapHeight: height });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <h2 className={SECTION_TITLE}>Scene: {scene.name}</h2>
      <Field label="Canvas atmosphere"><select className={INPUT} value={scene.boardStyle ?? 'midnight'} onChange={event => onPatch({ boardStyle: event.target.value as BoardStyle })}>{Object.entries(BOARD_STYLES).map(([id, style]) => <option key={id} value={id}>{style.label}</option>)}</select></Field>

      <div className="flex flex-col gap-1 text-xs text-slate-400">
        <span>Map</span>
        <div className="flex items-center gap-2">
          <label className={`${BUTTON} cursor-pointer`}>
            {hasMap ? 'Replace image' : 'Upload image'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadMap(file);
              }}
            />
          </label>
          <AssetPicker onSelect={url => {
            const image = new Image();
            image.onload = () => { onPatch({ mapUrl: url, mapWidth: image.naturalWidth, mapHeight: image.naturalHeight }); setError(null); };
            image.onerror = () => setError('Could not open the image.');
            image.src = url;
          }} />
          {hasMap && (
            <button className={BUTTON} onClick={() => onPatch({ mapUrl: undefined, mapWidth: undefined, mapHeight: undefined })}>
              Blank grid
            </button>
          )}
        </div>
        {error && <span className="text-rose-400">{error}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Cell (px)">
          <NumberInput value={scene.cell} min={10} onChange={(v) => onPatch({ cell: Math.max(10, v) })} />
        </Field>
        <label className="flex items-end gap-2 pb-1 text-xs text-slate-300">
          <input type="checkbox" checked={scene.showGrid} onChange={(e) => onPatch({ showGrid: e.target.checked })} />
          Show grid
        </label>
        <Field label="Offset X (px)">
          <NumberInput value={scene.offsetX} min={-100000} onChange={(v) => onPatch({ offsetX: v })} />
        </Field>
        <Field label="Offset Y (px)">
          <NumberInput value={scene.offsetY} min={-100000} onChange={(v) => onPatch({ offsetY: v })} />
        </Field>
        {!hasMap && (
          <>
            <Field label="Columns">
              <NumberInput value={scene.cols} min={1} onChange={(v) => onPatch({ cols: Math.max(1, v) })} />
            </Field>
            <Field label="Rows">
              <NumberInput value={scene.rows} min={1} onChange={(v) => onPatch({ rows: Math.max(1, v) })} />
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-slate-400">Ranges (cells, edge to edge)</span>
        <div className="grid grid-cols-2 gap-2">
          {BANDS.map((band, i) => (
            <Field key={band.name} label={band.name}>
              <NumberInput
                value={scene.ranges[i] ?? 0}
                step={0.5}
                onChange={(v) => {
                  const next = [...scene.ranges];
                  next[i] = v;
                  onPatch({ ranges: next });
                }}
              />
            </Field>
          ))}
        </div>
        <button className={BUTTON} onClick={() => onPatch({ ranges: [1, 3, 6, 12, 13] })}>
Rules default (1/3/6/12/13)
        </button>
      </div>
    </section>
  );
}
