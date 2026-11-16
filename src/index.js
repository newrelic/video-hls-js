import HLSTracker from './tracker';
import DaiTracker from './ads/dai';

// The UMD bundle is built with libraryExport: 'default', so window.HLSTracker is
// the class itself and named exports are unreachable from a script tag. Attach
// DaiTracker as a static so script-tag consumers can reach it.
HLSTracker.DaiTracker = DaiTracker;

export default HLSTracker;
export { HLSTracker, DaiTracker };
