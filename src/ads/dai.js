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
    return typeof streamManager?.getStreamTime === 'function';
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
    // Capture the stitched stream only. This is not an ad request: emitting one
    // here would also consume video-core's isRequested flag, which AD_START
    // depends on, and the flag is per-ad (see onAdStarted).
    this.streamData = this.extractStreamData(event);
  }

  onStreamInitialized() {
    this.sendDownload({ state: 'stream-initialized' });
  }

  onStreamError(event) {
    this.sendError(this.extractErrorData(event));
  }

  onAdBreakStarted(event) {
    this.adBreakData = this.extractAdBreakData(event);
    // Copy, never the live object: video-core's getAttributes() fills and
    // returns the very object it is handed, which would turn adBreakData — and
    // so getCurrentAdBreak() — into the whole telemetry payload.
    this.sendAdBreakStart({ ...this.adBreakData });
  }

  onAdBreakEnded() {
    // Attributes go out here rather than at AD_BREAK_STARTED: the break's
    // details are only known once its first ad has been seen (see onAdStarted).
    this.sendAdBreakEnd(this.adBreakData ? { ...this.adBreakData } : undefined);
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

  onAdStarted(event) {
    this.currentAdData = this.extractAdData(event);
    // AD_BREAK_STARTED carries no break information at all, so backfill it from
    // the first ad's pod info now that one exists.
    if (this.adBreakData) {
      if (this.adBreakData.position == null) {
        this.adBreakData.position = this.currentAdData.position;
      }
      if (this.adBreakData.adCount === undefined &&
          this.currentAdData.adCount !== undefined) {
        this.adBreakData.adCount = this.currentAdData.adCount;
      }
    }
    // Each ad needs its own request: video-core gates AD_START on
    // state.isRequested and clears it on both AD_END and AD_BREAK_END, so
    // without this only the session's first ad would ever report a start.
    this.sendRequest();
    this.sendStart();
  }

  onAdFirstQuartile() {
    this.sendAdQuartile({ quartile: 1 });
  }

  onAdMidpoint() {
    this.sendAdQuartile({ quartile: 2 });
  }

  onAdThirdQuartile() {
    this.sendAdQuartile({ quartile: 3 });
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
    const cuePoints = this.extractCuePoints(event);
    if (cuePoints) this.cuePoints = cuePoints;
  }

  onTimedMetadata(event) {
    this.timedMetadata = this.extractTimedMetadata(event);
  }

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

  /**
   * The DAI StreamEvent exposes no ad-break accessor (verified against the live
   * SDK: only getAd / getAdUi / getCustomAdUi / getStreamData / preventDefault),
   * so nothing about the break is knowable at AD_BREAK_STARTED. Both fields are
   * filled from the first ad's pod info in onAdStarted. Must stay non-null —
   * HLSTracker's content guard treats this object as "a break is in progress".
   */
  extractAdBreakData() {
    return { adCount: undefined, position: null };
  }

  extractAdData(event) {
    let ad;
    try {
      ad = event.getAd();
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract ad data', error);
      return {};
    }

    // Read each accessor independently. The IMA Ad surface varies by creative
    // and SDK version — notably it defines no getClickThroughUrl at all — and
    // one missing method must not discard the attributes that did resolve.
    const read = (name) => {
      try {
        return typeof ad?.[name] === 'function' ? ad[name]() : undefined;
      } catch (error) {
        nrvideo.Log.warn(`DaiTracker: ad.${name}() failed`, error);
        return undefined;
      }
    };

    return {
      adId: read('getAdId'),
      creativeId: read('getCreativeId'),
      duration: read('getDuration'),
      title: read('getTitle'),
      description: read('getDescription'),
      advertiserName: read('getAdvertiserName'),
      dealId: read('getDealId'),
      wrapperAdIds: read('getWrapperAdIds'),
      // Absent from today's DAI Ad object; read defensively so a future SDK
      // that adds it is picked up without another change here.
      clickThroughUrl: read('getClickThroughUrl'),
      position: this.extractAdPosition(ad),
      adCount: this.extractPodTotalAds(ad),
    };
  }

  extractPodTotalAds(ad) {
    try {
      const total = ad?.getAdPodInfo?.()?.getTotalAds?.();
      return typeof total === 'number' ? total : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Ad position from IMA's pod index, which is authoritative: podIndex 0 is a
   * pre-roll, -1 a post-roll, anything else a mid-roll. Playback time cannot be
   * used — under SSAI the ad itself advances the stitched stream's clock, so a
   * time-based guess reclassifies a long pre-roll as a mid-roll partway in.
   */
  extractAdPosition(ad) {
    try {
      const podIndex = ad?.getAdPodInfo?.()?.getPodIndex?.();
      if (podIndex === 0) return 'pre';
      if (podIndex === -1) return 'post';
      if (typeof podIndex === 'number') return 'mid';
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to read ad pod info', error);
    }
    return null;
  }

  /**
   * The DAI StreamEvent has no getError(); the only diagnostic the SDK provides
   * is StreamData.errorMessage, which carries the cause and HTTP status (e.g.
   * "Stream initialization failed... HTTP status code: 404"). There is no
   * numeric code field, so none is reported rather than inventing one.
   */
  extractErrorData(event) {
    try {
      const message = event.getStreamData?.()?.errorMessage;
      if (message) return { errorMessage: String(message) };
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract error data', error);
    }
    return { errorMessage: 'Unknown DAI error' };
  }

  /**
   * Cue points live on StreamData — the StreamEvent has no getCuepoints(). Only
   * CUEPOINTS_CHANGED actually carries them; other events report null, so a
   * missing list leaves the known one untouched rather than clearing it.
   */
  extractCuePoints(event) {
    try {
      const cuepoints = event.getStreamData?.()?.cuepoints;
      if (Array.isArray(cuepoints)) return cuepoints;
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract cue points', error);
    }
    return null;
  }

  extractTimedMetadata(event) {
    try {
      return {
        type: event.getType(),
        data: event.getData(),
      };
    } catch (error) {
      nrvideo.Log.warn('DaiTracker: Failed to extract timed metadata', error);
      return {};
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

  getVideoId() {
    return this.currentAdData?.adId ?? null;
  }

  getAdCreativeId() {
    return this.currentAdData?.creativeId ?? null;
  }

  getTitle() {
    return this.currentAdData?.title ?? null;
  }

  getDuration() {
    const duration = this.currentAdData?.duration;
    return duration === undefined || duration === null ? null : duration * 1000;
  }

  getClickThroughUrl() {
    return this.currentAdData?.clickThroughUrl ?? null;
  }

  getStreamType() {
    if (this.streamData?.streamType) return this.streamData.streamType;
    return this.tag?.duration === Infinity ? 'live' : 'vod';
  }

  // Returns the position captured when the ad started, so it stays constant
  // across every event of that ad instead of drifting as playback advances.
  getAdPosition() {
    return this.currentAdData?.position ?? this.adBreakData?.position ?? null;
  }

  /**
   * True while an ad is on screen. Checked by HLSTracker so content QoE stands
   * down during breaks.
   *
   * AD_BREAK_STARTED arrives only after playback has already entered the ad, so
   * the break object alone misses the first moments of a pre-roll — long enough
   * for a timeupdate to report CONTENT_START before any content has been shown.
   * The cue points, known ahead of playback, cover that window.
   */
  isAdPlaying() {
    if (this.adBreakData) return true;

    const cuePoints = this.cuePoints;
    if (!cuePoints?.length) return false;

    const streamTime = this.getPlayhead() / 1000;
    if (!Number.isFinite(streamTime)) return false;

    return cuePoints.some(
      (cue) => streamTime >= cue.start && streamTime < cue.end
    );
  }

  getCurrentAdBreak() {
    return this.adBreakData;
  }

  getCurrentAd() {
    return this.currentAdData;
  }

  getAdCuePoints() {
    return this.cuePoints;
  }

  getPlayhead() {
    try {
      return this.player.getStreamTime() * 1000;
    } catch (error) {
      return this.tag.currentTime * 1000;
    }
  }

  isMuted() {
    return this.tag.muted;
  }

  getRenditionHeight() {
    return null;
  }

  getRenditionWidth() {
    return null;
  }

  // The stitched stream is decoded by the same hls.js instance during ads, so
  // quality data lives on the content tracker, not the StreamManager.
  getBitrate() {
    return this.contentTracker?.getBitrate() ?? null;
  }

  getRenditionBitrate() {
    return this.contentTracker?.getBitrate() ?? null;
  }

  isLiveStream() {
    return this.getStreamType() === 'live';
  }

  getStreamData() {
    return this.streamData;
  }
}
