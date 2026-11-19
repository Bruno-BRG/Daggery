import { FearTracker } from './FearTracker';
import { MomentumTracker } from './MomentumTracker';

/** The Fear pool (the world's side) and Momentum (the hero's side), side by side in the top bar. */
export function DaggerheartTrackers() {
  return <div className="daggery-trackers"><MomentumTracker /><FearTracker /></div>;
}
