import nrvideo from '@newrelic/video-core';
import { version } from '../../package.json';

/**
 * Tracks Google IMA DAI (server-side stitched) ad breaks for an hls.js stream.
 *
 * Attach it to the content tracker with `hlsTracker.setAdsTracker(daiTracker)` —
 * that sets isAd()/parentTracker and funnels these events into the content
 * session as VideoAdAction. Never register this tracker with Core directly.
 */
export default class DaiTracker extends nrvideo.VideoTracker {
  constructor(streamManager, options) {
    super(streamManager, options);
    this.streamManager = streamManager;
    this.contentTracker = options?.contentTracker || null;
    this.currentAdData = null;
    this.adBreakData = null;
    this.streamData = null;
    this.cuePoints = [];
  }

  static isUsing(streamManager) {
    return false;
  }

  registerListeners() {
    if (!this.player || !google?.ima?.dai?.api?.StreamEvent) {
      nrvideo.Log.warn('DaiTracker: StreamManager or DAI API not available');
      return;
    }

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
      [StreamEvent.FIRST_QUARTILE]: this.onAdFirstQuartile.bind(this),
      [StreamEvent.MIDPOINT]: this.onAdMidpoint.bind(this),
      [StreamEvent.THIRD_QUARTILE]: this.onAdThirdQuartile.bind(this),
      [StreamEvent.COMPLETE]: this.onAdComplete.bind(this),
      [StreamEvent.SKIPPED]: this.onAdSkipped.bind(this),
      [StreamEvent.PAUSED]: this.onAdPaused.bind(this),
      [StreamEvent.RESUMED]: this.onAdResumed.bind(this),
      [StreamEvent.CLICK]: this.onAdClicked.bind(this),
      [StreamEvent.VIDEO_CLICKED]: this.onAdClicked.bind(this),

      [StreamEvent.CUEPOINTS_CHANGED]: this.onCuePointsChanged.bind(this),
      [StreamEvent.TIMED_METADATA]: this.onTimedMetadata.bind(this),
    };

    Object.entries(this.eventHandlers).forEach(([type, handler]) => {
      this.player.addEventListener(type, handler);
    });
  }

  unregisterListeners() {
    if (this.player && this.eventHandlers) {
      Object.entries(this.eventHandlers).forEach(([type, handler]) => {
        this.player.removeEventListener(type, handler);
      });
    }
    this.eventHandlers = null;
  }

  onStreamLoaded(event) {
    this.streamData = this.extractStreamData(event);
    this.sendRequest();
  }

  onStreamInitialized() {
    this.sendDownload({ state: 'stream-initialized' });
  }

  onStreamError(event) {
    this.sendError(this.extractErrorData(event));
  }

  onAdBreakStarted(event) {
    this.adBreakData = this.extractAdBreakData(event);
    this.sendAdBreakStart(this.adBreakData);
  }

  onAdBreakEnded() {
    this.sendAdBreakEnd();
    this.adBreakData = null;
  }

  onAdPeriodStarted(event) {
    // Bumpers and some live breaks fire only a period start, with no
    // AD_BREAK_STARTED to open the break.
    if (!this.adBreakData) {
      this.onAdBreakStarted(event);
    }
  }

  onAdPeriodEnded() {
    // Deliberately empty: the break may still have more ads in it.
  }

  onAdStarted() {}

  onAdFirstQuartile() {}

  onAdMidpoint() {}

  onAdThirdQuartile() {}

  onAdComplete() {}

  onAdSkipped() {}

  onAdPaused() {}

  onAdResumed() {}

  onAdClicked() {}

  onCuePointsChanged() {}

  onTimedMetadata() {}

  extractStreamData(event) {
    try {
      const streamData = event.getStreamData();
      return {
        streamId: streamData?.streamId,
        url: streamData?.url,
        adTagParameters: streamData?.adTagParameters,
        streamType: this.getStreamType(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract stream data', error);
      return {};
    }
  }

  extractAdBreakData(event) {
    try {
      const adBreak = event.getAdBreak();
      return {
        adBreakId: adBreak?.id,
        adBreakTitle: adBreak?.title,
        adCount: adBreak?.ads?.length || 0,
        position: this.getAdPosition(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract ad break data', error);
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
      nrvideo.Log.warn('DaiTracker: Failed to extract error data', error);
      return { errorMessage: 'Unknown DAI error' };
    }
  }

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
    return 'unknown';
  }

  getAdPartner() {
    return 'google-dai';
  }

  getSrc() {
    return this.streamData?.url ?? null;
  }

  getStreamType() {
    if (this.streamData?.streamType) return this.streamData.streamType;
    return this.tag?.duration === Infinity ? 'live' : 'vod';
  }

  getAdPosition() {
    if (!this.currentAdData && !this.adBreakData) return null;

    const currentTime = this.tag?.currentTime;
    const duration = this.tag?.duration;

    if (currentTime < 5) return 'pre';
    if (duration && currentTime > duration - 10) return 'post';
    return 'mid';
  }

  getCurrentAdBreak() {
    return this.adBreakData;
  }

  getStreamData() {
    return this.streamData;
  }
}
