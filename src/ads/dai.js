/* global google */
import nrvideo from '@newrelic/video-core';
import { version } from '../../package.json';

// DAI SDK objects don't all expose the same getters: tolerate missing ones
const call = (obj, name) => {
  try {
    return obj?.[name]?.();
  } catch (e) {
    return undefined;
  }
};

/**
 * Google DAI (SSAI) ad tracker for hls.js.
 *
 * Ported from video-videojs-js/src/ads/dai.js. Unlike videojs there is no DAI
 * plugin, so the host app creates the StreamManager and hands it over through
 * HLSTracker.setStreamManager().
 */
export default class DaiAdsTracker extends nrvideo.VideoTracker {
  constructor(player, options) {
    super(player, options);
    this.streamManager = null;
    this.eventHandlers = null;
    this.currentAdData = null;
    this.adBreakData = null;
    this.streamData = null;
    this.cuePoints = [];
  }

  setPlayer(player, tag) {
    if (!tag && player?.media) tag = player.media;
    nrvideo.VideoTracker.prototype.setPlayer.call(this, player, tag);
  }

  setStreamManager(streamManager) {
    this.unregisterListeners();
    this.streamManager = streamManager;
    this.registerListeners();
  }

  registerListeners() {
    if (!this.streamManager || !google?.ima?.dai?.api?.StreamEvent) return;

    const StreamEvent = google.ima.dai.api.StreamEvent.Type;

    this.eventHandlers = {
      [StreamEvent.LOADED]: this.onStreamLoaded.bind(this),
      [StreamEvent.STREAM_INITIALIZED]: this.onStreamInitialized.bind(this),
      [StreamEvent.ERROR]: this.onStreamError.bind(this),
      [StreamEvent.AD_BREAK_STARTED]: this.onAdBreakStarted.bind(this),
      [StreamEvent.AD_BREAK_ENDED]: this.onAdBreakEnded.bind(this),
      [StreamEvent.AD_PERIOD_STARTED]: this.onAdPeriodStarted.bind(this),
      [StreamEvent.AD_PERIOD_ENDED]: this.onAdPeriodEnded.bind(this),
      [StreamEvent.STARTED]: this.onAdStarted.bind(this),
      [StreamEvent.FIRST_QUARTILE]: this.onAdQuartile.bind(this, 1),
      [StreamEvent.MIDPOINT]: this.onAdQuartile.bind(this, 2),
      [StreamEvent.THIRD_QUARTILE]: this.onAdQuartile.bind(this, 3),
      [StreamEvent.COMPLETE]: this.onAdComplete.bind(this),
      [StreamEvent.SKIPPED]: this.onAdSkipped.bind(this),
      [StreamEvent.PAUSED]: this.onAdPaused.bind(this),
      [StreamEvent.RESUMED]: this.onAdResumed.bind(this),
      [StreamEvent.CLICK]: this.onAdClicked.bind(this),
      [StreamEvent.VIDEO_CLICKED]: this.onAdClicked.bind(this),
      [StreamEvent.CUEPOINTS_CHANGED]: this.onCuePointsChanged.bind(this),
    };

    Object.entries(this.eventHandlers).forEach(([type, handler]) => {
      this.streamManager.addEventListener(type, handler);
    });
  }

  unregisterListeners() {
    if (this.streamManager && this.eventHandlers) {
      Object.entries(this.eventHandlers).forEach(([type, handler]) => {
        this.streamManager.removeEventListener(type, handler);
      });
    }
    this.eventHandlers = null;
  }

  // Stream events
  onStreamLoaded(event) {
    this.streamData = this.extractStreamData(event);
  }

  onStreamInitialized() {
    this.sendDownload({ state: 'stream-initialized' });
  }

  onStreamError(event) {
    this.sendError(this.extractErrorData(event));
  }

  // Ad break events
  onAdBreakStarted(event) {
    this.adBreakData = this.extractAdBreakData(event);
    this.sendRequest();
    this.sendAdBreakStart(this.adBreakData);
  }

  onAdBreakEnded() {
    this.sendAdBreakEnd();
    this.adBreakData = null;
  }

  onAdPeriodStarted(event) {
    // Bumpers etc. arrive as periods without a break event
    if (!this.adBreakData) this.onAdBreakStarted(event);
  }

  onAdPeriodEnded() {
    // Break stays open: more ads may follow
  }

  // Ad events
  onAdStarted(event) {
    this.currentAdData = this.extractAdData(event);
    // Core resets the request flag on each AD_END, so every ad needs its own
    this.sendRequest();
    this.sendStart();
  }

  onAdQuartile(quartile) {
    this.sendAdQuartile({ quartile });
  }

  onAdComplete() {
    this.sendEnd();
    this.currentAdData = null;
  }

  onAdSkipped() {
    this.sendEnd({ skipped: true });
    this.currentAdData = null;
  }

  onAdPaused() {
    this.sendPause();
  }

  onAdResumed() {
    this.sendResume();
  }

  onAdClicked() {
    this.sendAdClick({ url: this.getClickThroughUrl() });
  }

  onCuePointsChanged(event) {
    this.cuePoints = this.extractCuePoints(event);
  }

  // Data extraction
  extractStreamData(event) {
    try {
      const streamData = event.getStreamData();
      return {
        streamId: streamData?.streamId,
        url: streamData?.url,
        streamType: this.getStreamType(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiAdsTracker: Failed to extract stream data', error);
      return {};
    }
  }

  extractAdBreakData(event) {
    try {
      const adBreak = event.getAdBreak?.();
      return {
        adBreakId: adBreak?.id,
        adBreakTitle: adBreak?.title,
        adCount: adBreak?.ads?.length,
        position: this.getAdPosition(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiAdsTracker: Failed to extract ad break data', error);
      return {};
    }
  }

  extractAdData(event) {
    try {
      const ad = event.getAd();
      return {
        adId: call(ad, 'getAdId'),
        creativeId: call(ad, 'getCreativeId'),
        duration: call(ad, 'getDuration'),
        title: call(ad, 'getTitle'),
        description: call(ad, 'getDescription'),
        advertiserName: call(ad, 'getAdvertiserName'),
        clickThroughUrl: call(ad, 'getClickThroughUrl'),
        dealId: call(ad, 'getDealId'),
        wrapperAdIds: call(ad, 'getWrapperAdIds'),
        podTimeOffset: call(call(ad, 'getAdPodInfo'), 'getTimeOffset'),
        position: this.getAdPosition(ad),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiAdsTracker: Failed to extract ad data', error);
      return {};
    }
  }

  extractErrorData(event) {
    try {
      const error = event.getError();
      return {
        errorCode: error?.getErrorCode(),
        errorMessage: error?.getMessage(),
        innerError: error?.getInnerError(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiAdsTracker: Failed to extract error data', error);
      return { errorMessage: 'Unknown DAI error' };
    }
  }

  extractCuePoints(event) {
    try {
      return event.getStreamData()?.cuepoints || [];
    } catch (error) {
      nrvideo.Log.warn('DaiAdsTracker: Failed to extract cue points', error);
      return [];
    }
  }

  // Tracker getters
  getTrackerName() {
    return 'dai-ads';
  }

  getTrackerVersion() {
    return version;
  }

  getPlayerName() {
    return 'hls-dai';
  }

  getPlayerVersion() {
    return google?.ima?.dai?.api?.VERSION ?? this.player?.constructor?.version ?? null;
  }

  getInstrumentationProvider() {
    return 'New Relic';
  }

  getAdPartner() {
    return 'google-dai';
  }

  getAdCuePoints() {
    return this.cuePoints;
  }

  getAdPosition(ad) {
    // Core calls this with no args when building event attributes
    if (!ad && this.currentAdData?.position) return this.currentAdData.position;
    if (!ad && !this.currentAdData && !this.adBreakData) return null;

    // VOD pod time offset: 0 = pre-roll, -1 = post-roll, anything else = mid-roll.
    // Live streams report 0 for every pod, so fall through to the time heuristic.
    if (this.getStreamType() === 'vod') {
      const offset = call(call(ad, 'getAdPodInfo'), 'getTimeOffset');
      if (offset === 0) return 'pre';
      if (offset === -1) return 'post';
      if (offset > 0) return 'mid';
    }

    const currentTime = this.tag?.currentTime ?? 0;
    const duration = this.tag?.duration;
    if (currentTime < 5) return 'pre';
    if (duration && isFinite(duration) && currentTime > duration - 10) return 'post';
    return 'mid';
  }

  getStreamType() {
    // Live DAI event streams report a finite, growing duration, so also ask hls.js
    const live = this.player?.liveSyncPosition != null || this.tag?.duration === Infinity;
    return live ? 'live' : 'vod';
  }

  getPlayhead() {
    return (this.tag?.currentTime ?? 0) * 1000;
  }

  getDuration() {
    const duration = this.currentAdData?.duration;
    return duration !== undefined ? duration * 1000 : null;
  }

  getVideoId() {
    return this.currentAdData?.adId || null;
  }

  getAdCreativeId() {
    return this.currentAdData?.creativeId || null;
  }

  getTitle() {
    return this.currentAdData?.title || null;
  }

  getSrc() {
    return this.streamData?.url || null;
  }

  getClickThroughUrl() {
    return this.currentAdData?.clickThroughUrl || null;
  }

  isMuted() {
    return this.tag?.muted ?? null;
  }
}
