import { fightNet, type FightRecord, type MomentumTracker } from '@daggery/shared';
import { Icon } from '../components/Icon';
import { signed } from './useMomentum';

const net = (fight: FightRecord) => {
  const value = fightNet(fight);
  return value === 0 ? 'even' : signed(value);
};

/**
 * The Momentum of a fight. It begins when the fight begins and follows every change, so you can see
 * how the fight went for you. The last few fights stay below it.
 */
export function FightMomentum({ tracker }: { tracker: MomentumTracker }) {
  const { fight, history } = tracker;
  if (!fight && history.length === 0) return <p className="tracker-note">Start a fight and its Momentum is recorded here.</p>;
  return (
    <div className="fight-momentum">
      {fight ? (
        <dl className="fight-now" aria-label="Momentum of this fight">
          <div><dt>Start</dt><dd>{signed(fight.start)}</dd></div>
          <div><dt>Now</dt><dd className={fight.end < 0 ? 'is-neg' : undefined}>{signed(fight.end)}</dd></div>
          <div><dt>Best</dt><dd>{signed(fight.peak)}</dd></div>
          <div><dt>Worst</dt><dd className={fight.low < 0 ? 'is-neg' : undefined}>{signed(fight.low)}</dd></div>
          <div><dt>Net</dt><dd className={fightNet(fight) < 0 ? 'is-neg' : undefined}>{net(fight)}</dd></div>
        </dl>
      ) : <p className="tracker-note">No fight is on. Your last fights:</p>}
      {history.length > 0 && (
        <ol className="fight-history" aria-label="Earlier fights">
          {history.map((item, index) => (
            <li key={index}>
              <Icon name="combat" />
              <span>{signed(item.start)} → {signed(item.end)}</span>
              <small>best {signed(item.peak)} · worst {signed(item.low)}</small>
              <strong className={fightNet(item) < 0 ? 'is-neg' : undefined}>{net(item)}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
