import type { Ctx, LogDoc, LogEvent } from './model';
import { Badge, Button, Panel, type Tone } from './ui';

const EVENT_TONE: Record<LogEvent, Tone> = {
  damage: 'rose',
  defeat: 'rose',
  roll: 'sky',
  fear: 'amber',
  spotlight: 'emerald',
  feature: 'violet',
  countdown: 'amber',
};

const EVENT_LABEL: Record<LogEvent, string> = {
  damage: 'Damage',
  defeat: 'Defeat',
  roll: 'Roll',
  fear: 'Fear',
  spotlight: 'Spotlight',
  feature: 'Feature',
  countdown: 'Countdown',
};

const SHOWN = 150;

/** Newest first. Players see only the entries that have a player line. */
export function CombatLog({ ctx, entries }: { ctx: Ctx; entries: [string, LogDoc][] }) {
  const visible = entries.filter(([, entry]) => ctx.isGM || entry.playerText !== undefined).slice(-SHOWN).reverse();

  function clear() {
    if (!window.confirm('Delete the entire combat log?')) return;
    for (const [id] of entries) ctx.remove(id);
  }

  return (
    <Panel
      title="Combat log"
      action={
        ctx.isGM && entries.length > 0 ? (
          <Button tone="rose" onClick={clear}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <p className="text-xs text-slate-500">No events yet.</p>
      ) : (
        <ol className="flex max-h-96 flex-col gap-1.5 overflow-auto pr-1 text-xs">
          {visible.map(([id, entry]) => (
            <li key={id} className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Badge tone={EVENT_TONE[entry.event]}>{EVENT_LABEL[entry.event]}</Badge>
                  <span>{entry.author}</span>
                </span>
                <span className="tabular-nums">{new Date(entry.at).toLocaleTimeString()}</span>
              </div>
              <div className="mt-1 text-slate-200">{ctx.isGM ? entry.text : entry.playerText}</div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
