import pkg from '../package.json';
import HLSTracker from './tracker';
import { getRegisteredHarvester } from '@newrelic/video-core';

/**
 * VegaTracker — HLS.js tracker for the Amazon Vega SDK
 * (Kepler / Fire TV class devices).
 *
 * Structurally identical to HLSTracker with one extra step: injects
 * `src: 'Vega'` via the `super` spread so events flow through the
 * connected-device pipeline instead of the browser pipeline.
 *
 * Usage:
 *   import { VegaTracker } from '@newrelic/video-hls/vega';
 *
 *   tracker = new VegaTracker(hlsInstance, {
 *     tag: videoPlayer,          // required — see note below
 *     info: {
 *       accountId:        'YOUR_ACCOUNT_ID',
 *       applicationToken: 'YOUR_NRMA_TOKEN',
 *       endpoint:         'US',  // 'US' | 'EU' | 'staging' | 'GOV' | 'JP'
 *       deviceInfo,
 *     },
 *   });
 *
 * 
 */
export default class VegaTracker extends HLSTracker {
  constructor(player, options) {
    super(player, { ...options, src: 'Vega' });
  }

  getHarvester() {
    return getRegisteredHarvester('Vega');
  }

  getTrackerName() {
    return 'vega-hls';
  }

  getTrackerVersion() {
    return pkg.version;
  }

  getAttributes(att, eventType) {
    att = super.getAttributes(att, eventType);
    delete att.pageUrl;
    delete att.isBackgroundEvent;
    return att;
  }
}
