import HLSTracker from '../../tracker';
import DaiTracker from '../../ads/dai';
import Hls from 'hls.js';

/**
 * The content guard, exercised through the path the real integration takes.
 *
 * tracker.test.js drives the guard with a fake ads tracker that exposes only
 * isAd() and getCurrentAdBreak(). isAdsTrackerActive() PREFERS isAdPlaying()
 * when it exists, and the real DaiTracker has it, so those tests only ever
 * reach the getCurrentAdBreak() fallback branch — a branch the real
 * integration never uses. Everything here wires a REAL DaiTracker to a REAL
 * HLSTracker through setAdsTracker() and drives the ad state with real DAI
 * StreamEvents.
 *
 * This file needs its own video-core mock: the shared one at
 * node_modules/@newrelic/video-core/__mock__.js has setAdsTracker() as a no-op,
 * so `tracker.adsTracker` would never be set and nothing below would be
 * testing the wiring.
 */
jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.options = options || {};
      this.state = {};
      this._isAd = false;
      this.setPlayer(player, this.options.tag);
    }

    // The real base does `tag = tag || player` and then registers listeners.
    setPlayer(player, tag) {
      this.player = player;
      this.tag = tag || player;
      if (this.player) this.registerListeners();
    }

    isAd() {
      return this._isAd;
    }

    setIsAd(value) {
      this._isAd = value;
    }

    /**
     * video-core 5.1.1's own wiring, from the shipped bundle:
     *
     *   setAdsTracker(e){this.disposeAdsTracker(),e&&(this.adsTracker=e,
     *     this.adsTracker.setIsAd(!0),this.adsTracker.parentTracker=this,...)}
     *
     * The '*' event forwarding is left out: these tests assert on the
     * trackers' own send* calls, not on what Core harvests.
     */
    setAdsTracker(adsTracker) {
      if (!adsTracker) return;
      this.adsTracker = adsTracker;
      this.adsTracker.setIsAd(true);
      this.adsTracker.parentTracker = this;
    }

    registerListeners() {}
    unregisterListeners() {}

    dispose() {
      this.unregisterListeners();
      this.player = null;
      this.tag = null;
    }

    sendDownload() {}
    sendRequest() {}
    sendPlayerReady() {}
    sendBufferStart() {}
    sendBufferEnd() {}
    sendResume() {}
    sendStart() {}
    sendPause() {}
    sendSeekStart() {}
    sendSeekEnd() {}
    sendError() {}
    sendEnd() {}
    sendAdBreakStart() {}
    sendAdBreakEnd() {}
    sendAdClick() {}
    sendAdQuartile() {}
    sendRenditionChanged() {}
    getTrackerVersion() {
      return '1.0.0';
    }
  }

  const nrvideo = {
    VideoTracker,
    Core: { addTracker: jest.fn() },
    Log: {
      debugCommonVideoEvents: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      notice: jest.fn(),
    },
  };
  return { ...nrvideo, default: nrvideo };
});

const StreamEventType = {
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click',
  VIDEO_CLICKED: 'videoClicked', CUEPOINTS_CHANGED: 'cuepointsChanged',
  AD_PROGRESS: 'adProgress',
};

beforeEach(() => {
  global.google = {
    ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } },
  };
});

// A video element that records what HLSTracker actually registered, so the
// tests can fire DOM events through the real registration path rather than
// calling the handlers by name.
function createVideoElement(currentTime = 0) {
  const listeners = {};
  return {
    currentTime,
    duration: 120,
    muted: false,
    networkState: 2,
    readyState: 0,
    NETWORK_LOADING: 2,
    HAVE_FUTURE_DATA: 3,
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type, cb) => {
      if (listeners[type] === cb) delete listeners[type];
    }),
    _fire(type) {
      if (!listeners[type]) throw new Error(`no listener registered for '${type}'`);
      listeners[type]({ type });
    },
  };
}

function createStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type, cb) => {
      if (listeners[type] === cb) delete listeners[type];
    }),
    contentTimeForStreamTime: jest.fn((streamTime) => streamTime),
    _emit(type, event) { if (listeners[type]) listeners[type](event || {}); },
  };
}

// Builds the integration exactly as the README tells an application to.
function wireUp({ currentTime = 0 } = {}) {
  const video = createVideoElement(currentTime);
  const hls = {
    url: 'https://example.test/stitched.m3u8',
    currentLevel: 0,
    levels: [{ bitrate: 258157, width: 426, height: 180, details: { live: false } }],
    on: jest.fn(),
    off: jest.fn(),
    media: video,
    constructor: Hls,
  };

  const tracker = new HLSTracker(hls, {});
  const streamManager = createStreamManager();
  const daiTracker = new DaiTracker(streamManager, {
    tag: video,
    contentTracker: tracker,
  });
  tracker.setAdsTracker(daiTracker);

  [
    'sendRequest', 'sendResume', 'sendStart', 'sendPause', 'sendSeekStart',
    'sendSeekEnd', 'sendBufferStart', 'sendBufferEnd', 'sendEnd',
  ].forEach((m) => { tracker[m] = jest.fn(); });

  return { video, hls, tracker, daiTracker, streamManager };
}

// A VOD pre-roll's cue point, as CUEPOINTS_CHANGED reports it.
function announceCuePoints(streamManager, cuepoints) {
  streamManager._emit(StreamEventType.CUEPOINTS_CHANGED, {
    getStreamData: () => ({ cuepoints }),
  });
}

function startAd(streamManager, adId = 'ad1') {
  streamManager._emit(StreamEventType.STARTED, {
    getAd: () => ({
      getAdId: () => adId,
      getDuration: () => 10,
      getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 1 }),
    }),
  });
}

describe('setAdsTracker wiring', () => {
  it('links the two trackers so the guard consults the real DaiTracker', () => {
    const { tracker, daiTracker } = wireUp();

    expect(tracker.adsTracker).toBe(daiTracker);
    expect(daiTracker.isAd()).toBe(true);
    expect(daiTracker.parentTracker).toBe(tracker);
  });

  // The point of this file: the real DaiTracker HAS isAdPlaying(), so the
  // guard's getCurrentAdBreak() fallback is dead code in the real integration.
  it('runs the guard through isAdPlaying(), not the ad-break fallback', () => {
    const { tracker, daiTracker, streamManager } = wireUp();
    jest.spyOn(daiTracker, 'isAdPlaying');
    jest.spyOn(daiTracker, 'getCurrentAdBreak');

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.isAdsTrackerActive()).toBe(true);

    expect(daiTracker.isAdPlaying).toHaveBeenCalled();
    expect(daiTracker.getCurrentAdBreak).not.toHaveBeenCalled();
  });
});

describe('content events during a real DAI ad break', () => {
  it('suppresses content pause, and reports it again once the break ends', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    startAd(streamManager);
    video._fire('pause');
    expect(tracker.sendPause).not.toHaveBeenCalled();

    streamManager._emit(StreamEventType.COMPLETE, {});
    streamManager._emit(StreamEventType.AD_BREAK_ENDED, {});
    video._fire('pause');
    expect(tracker.sendPause).toHaveBeenCalledTimes(1);
  });

  it('suppresses content seek start and seek end', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    video._fire('seeking');
    video._fire('seeked');

    expect(tracker.sendSeekStart).not.toHaveBeenCalled();
    expect(tracker.sendSeekEnd).not.toHaveBeenCalled();
  });

  it('suppresses a content buffer start', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });
    video.readyState = 0; // stalled: < HAVE_FUTURE_DATA, still NETWORK_LOADING

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    video._fire('waiting');

    expect(tracker.sendBufferStart).not.toHaveBeenCalled();
  });

  it('suppresses a content buffer end and a content resume', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    video._fire('playing');
    video._fire('canplaythrough');

    expect(tracker.sendResume).not.toHaveBeenCalled();
    expect(tracker.sendBufferEnd).not.toHaveBeenCalled();
  });

  // The asymmetry: opening a content transition during a break is suppressed,
  // closing one that was ALREADY OPEN is not. video-core bills
  // (stopTime - startTime) to totalRebufferingTime, so holding a buffer open
  // across the break charges the whole ad pod to content.
  it('still closes a content buffer that was open when the break began', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });
    tracker.state = { isBuffering: true };

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    video._fire('playing');

    expect(tracker.sendBufferEnd).toHaveBeenCalled();
    // Content is not resuming — the ad is on screen.
    expect(tracker.sendResume).not.toHaveBeenCalled();
  });

  it('still closes a content seek that straddles the break boundary', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });
    tracker.state = { isSeeking: true };

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    video._fire('seeked');

    expect(tracker.sendSeekEnd).toHaveBeenCalled();
  });

  // A period-only break (bumpers, and some live breaks) is opened and closed
  // by DaiTracker itself, with no AD_BREAK_STARTED from the SDK at all.
  it('suppresses content for a break opened by AD_PERIOD_STARTED alone', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 100 });

    streamManager._emit(StreamEventType.AD_PERIOD_STARTED, {});
    video._fire('pause');
    expect(tracker.sendPause).not.toHaveBeenCalled();

    streamManager._emit(StreamEventType.AD_PERIOD_ENDED, {});
    video._fire('pause');
    expect(tracker.sendPause).toHaveBeenCalledTimes(1);
  });
});

describe('CONTENT_START across a real pre-roll', () => {
  // Under SSAI the stitched clock advances through the ad, so timeupdate fires
  // during a pre-roll with a playhead well past the 0.1s threshold. Reporting
  // CONTENT_START there marks content as started before any content was shown.
  it('is not reported during a pre-roll the SDK has announced', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 0 });

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    startAd(streamManager);

    video.currentTime = 5; // 5s into a 10s pre-roll
    video._fire('timeupdate');

    expect(tracker.sendStart).not.toHaveBeenCalled();
  });

  // The window the ad-break fallback cannot cover: AD_BREAK_STARTED arrives
  // only after playback has entered the ad, so at the first timeupdate the
  // break object is still null and ONLY the cue-point arm of isAdPlaying()
  // knows an ad is on screen.
  it('is not reported before the SDK has announced the pre-roll', () => {
    const { video, tracker, daiTracker, streamManager } = wireUp({ currentTime: 0 });
    announceCuePoints(streamManager, [{ start: 0, end: 10.01, played: false }]);

    video.currentTime = 0.5;
    video._fire('timeupdate');

    expect(daiTracker.getCurrentAdBreak()).toBeNull();
    expect(tracker.sendStart).not.toHaveBeenCalled();
  });

  it('is reported on the first content timeupdate after the pre-roll', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 0 });
    announceCuePoints(streamManager, [{ start: 0, end: 10.01, played: false }]);

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    startAd(streamManager);
    video.currentTime = 5;
    video._fire('timeupdate');
    expect(tracker.sendStart).not.toHaveBeenCalled();

    streamManager._emit(StreamEventType.COMPLETE, {});
    streamManager._emit(StreamEventType.AD_BREAK_ENDED, {});
    announceCuePoints(streamManager, [{ start: 0, end: 10.01, played: true }]);
    video.currentTime = 10.5; // first content frame
    video._fire('timeupdate');

    expect(tracker.sendStart).toHaveBeenCalledTimes(1);
  });

  // contentPlayhead must be content time: the stitched clock includes the
  // pre-roll, so reporting it raw overstates content progress by the ad length.
  it('reports the content playhead in content time after the pre-roll', () => {
    const { video, tracker, streamManager } = wireUp({ currentTime: 0 });
    streamManager.contentTimeForStreamTime = jest.fn((streamTime) => streamTime - 10.01);

    streamManager._emit(StreamEventType.AD_BREAK_STARTED, {});
    startAd(streamManager);
    streamManager._emit(StreamEventType.COMPLETE, {});
    streamManager._emit(StreamEventType.AD_BREAK_ENDED, {});

    video.currentTime = 20.01;
    expect(tracker.getPlayhead()).toBeCloseTo(10000, 6);
  });
});
