import VegaTracker from './vegaTracker';

/**
 * Vega-only entry for the `/vega` webpack build.
 *
 * resolve.alias rewires @newrelic/video-core -> @newrelic/video-core/vega
 * so only the connected-device pipeline is bundled.
 */
export default VegaTracker;
export { VegaTracker };
