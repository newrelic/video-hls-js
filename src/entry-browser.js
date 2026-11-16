import HLSTracker from './tracker';
import DaiTracker from './ads/dai';

// See src/index.js — UMD/script-tag consumers reach DAI via HLSTracker.DaiTracker.
HLSTracker.DaiTracker = DaiTracker;

export { default as HLSTracker } from './tracker';
export { default as DaiTracker } from './ads/dai';
export default HLSTracker;
