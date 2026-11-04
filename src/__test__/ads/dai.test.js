import DaiTracker from '../../ads/dai';
import nrvideo from '@newrelic/video-core';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      this.tag = this.options.tag || player; // matches real base: tag || player
      this._isAd = false;
      if (player) this.registerListeners();
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    registerListeners() {}
    // Mirrors the real base (videotracker.ts:212-218): it nulls player and tag,
    // which is precisely what made a disposed tracker throw.
    dispose() {
      this.unregisterListeners();
      this.player = null;
      this.tag = null;
    }
    unregisterListeners() {}
    sendRequest() {}
    sendDownload() {}
    sendError() {}
    sendAdBreakStart() {}
    sendAdBreakEnd() {}
    sendStart() {}
    sendAdQuartile() {}
    sendEnd() {}
    sendPause() {}
    sendResume() {}
    sendAdClick() {}
  }
  const nrvideo = {
    VideoTracker,
    Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  return { ...nrvideo, default: nrvideo };
});

const StreamEventType = {
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click', VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged', TIMED_METADATA: 'timedMetadata',
};

// Every StreamEvent type DaiTracker subscribes to. TIMED_METADATA is
// deliberately absent — see 'does not subscribe to TIMED_METADATA'.
const HANDLED_EVENT_TYPES = [
  StreamEventType.LOADED,
  StreamEventType.STREAM_INITIALIZED,
  StreamEventType.ERROR,
  StreamEventType.AD_BREAK_STARTED,
  StreamEventType.AD_BREAK_ENDED,
  StreamEventType.AD_PERIOD_STARTED,
  StreamEventType.AD_PERIOD_ENDED,
  StreamEventType.STARTED,
  StreamEventType.FIRST_QUARTILE,
  StreamEventType.MIDPOINT,
  StreamEventType.THIRD_QUARTILE,
  StreamEventType.COMPLETE,
  StreamEventType.SKIPPED,
  StreamEventType.PAUSED,
  StreamEventType.RESUMED,
  StreamEventType.CLICK,
  StreamEventType.VIDEO_CLICKED,
  StreamEventType.CUEPOINTS_CHANGED,
];

beforeEach(() => {
  jest.clearAllMocks();
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

// Mirrors the LIVE StreamManager surface, enumerated from the real SDK:
//   addEventListener, clicked, contentTimeForStreamTime, dispatchEvent, focus,
//   getAdSkippableState, listen, loadStreamMetadata, onTimedMetadata,
//   previousCuePointForStreamTime, processMetadata, removeEventListener,
//   replaceAdTagParameters, requestStream, reset, setClickElement, skipAd,
//   streamTimeForContentTime
// Note there is NO getStreamTime: an earlier version of this fixture invented
// one, which hid the fact that getPlayhead() always took its fallback path and
// that isUsing() could never match a real StreamManager.
function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    contentTimeForStreamTime: jest.fn((streamTime) => streamTime),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockTag(currentTime = 3) {
  return { currentTime, duration: 120, muted: false };
}

describe('DaiTracker — construction & lifecycle', () => {
  it('subscribes to exactly the StreamEvent types it handles', () => {
    const sm = createMockStreamManager();
    new DaiTracker(sm, { tag: createMockTag() });
    const subscribed = sm.addEventListener.mock.calls.map(([type]) => type).sort();
    expect(subscribed).toEqual([...HANDLED_EVENT_TYPES].sort());
  });

  // Optional chaining does not protect an UNDECLARED identifier, so
  // `!google?.ima...` threw a ReferenceError out of the constructor when the
  // IMA SDK had not been loaded — contradicting the README's documented
  // no-op-with-a-warning behaviour.
  it('warns instead of throwing when the IMA DAI SDK is absent', () => {
    delete global.google;
    const sm = createMockStreamManager();
    let tracker;
    expect(() => { tracker = new DaiTracker(sm, { tag: createMockTag() }); }).not.toThrow();
    expect(nrvideo.Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('DAI API not available')
    );
    expect(sm.addEventListener).not.toHaveBeenCalled();
    // And it must stay inert rather than half-wired.
    expect(() => tracker.unregisterListeners()).not.toThrow();
    expect(tracker.isAdPlaying()).toBe(false);
  });

  // video-core's disposeAdsTracker() calls dispose() — which nulls player and
  // tag — but never clears this.adsTracker. So after setAdsTracker(null) the
  // content guard still consults a disposed ads tracker, and a getPlayhead()
  // on it threw a TypeError straight out of the host page's event handler.
  it('stays inert after being disposed instead of throwing', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: false }] }),
    });
    expect(tracker.isAdPlaying()).toBe(true);

    tracker.dispose();

    expect(() => tracker.isAdPlaying()).not.toThrow();
    expect(tracker.isAdPlaying()).toBe(false);
    expect(() => tracker.getPlayhead()).not.toThrow();
  });

  it('removes all listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    tracker.unregisterListeners();
    const removed = sm.removeEventListener.mock.calls.map(([type]) => type).sort();
    expect(removed).toEqual([...HANDLED_EVENT_TYPES].sort());
  });

  // LOADED only captures the stitched stream. It must NOT emit an ad request:
  // that would consume video-core's per-ad isRequested flag that AD_START
  // depends on. See 'requests before every ad start'.
  it('LOADED captures stream data without emitting an ad request', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendRequest');
    const event = { getStreamData: () => ({ streamId: 's1', url: 'https://x/master.m3u8', adTagParameters: {} }) };
    sm._emit(StreamEventType.LOADED, event);
    expect(tracker.getSrc()).toBe('https://x/master.m3u8');
    expect(tracker.sendRequest).not.toHaveBeenCalled();
  });

  it('STREAM_INITIALIZED calls sendDownload({ state: "stream-initialized" })', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendDownload');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendDownload).toHaveBeenCalledWith({ state: 'stream-initialized' });
  });

  // The live DAI StreamEvent has no getAdBreak() — only getAd, getAdUi,
  // getCustomAdUi, getStreamData — so a break opens with no
  // detail of its own and is backfilled from its first ad's pod info.
  it('AD_BREAK_STARTED opens a break and calls sendAdBreakStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
    // Non-null is the contract HLSTracker's content guard relies on.
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  it('AD_BREAK_ENDED calls sendAdBreakEnd() and clears the current break', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  // The break's details are only known once its first ad has been seen, so the
  // end event is the one that can actually carry them to the backend.
  // `position` is internal bookkeeping: video-core already publishes it as
  // adPosition via getAdPosition(), so sending it too would ship two differently
  // named copies of the same value.
  it('does not ship an internal position key alongside adPosition', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, {
      getAd: () => ({
        getAdId: () => 'ad1',
        getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 1 }),
      }),
    });
    // adPosition still reaches the backend through the normal getter, while the
    // ad is live.
    expect(tracker.getAdPosition()).toBe('pre');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    for (const spy of [tracker.sendAdBreakStart, tracker.sendAdBreakEnd]) {
      const att = spy.mock.calls[0][0] ?? {};
      expect(att).not.toHaveProperty('position');
    }
  });

  it('AD_BREAK_ENDED reports the backfilled break details', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, {
      getAd: () => ({
        getAdId: () => 'ad1',
        getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 2 }),
      }),
    });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledWith({ adCount: 2 });
  });

  it('AD_PERIOD_STARTED with no current break falls back to starting a break', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'bumper', ads: [] }) });
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
  });

  it('AD_PERIOD_STARTED with a current break does not start a second one', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    expect(tracker.sendAdBreakStart).not.toHaveBeenCalled();
  });

  // A break opened by a period event has no AD_BREAK_ENDED coming — that is the
  // whole premise of the period fallback — so the period end must close it, or
  // the break stays open forever and silences content telemetry for good.
  it('AD_PERIOD_ENDED closes a break that a period event opened', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
    expect(tracker.isAdPlaying()).toBe(false);
  });

  it('AD_PERIOD_ENDED leaves an SDK-announced break open (more ads may follow)', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  // The live StreamEvent has no getError(); the diagnostic lives on StreamData.
  it('ERROR reports the SDK error message from StreamData', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({
        errorMessage: 'Stream initialization failed. HTTP status code: 404',
      }),
    });
    expect(tracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'Stream initialization failed. HTTP status code: 404',
      })
    );
  });

  // StreamEvent.ERROR is predominantly stream-level — "Stream initialization
  // failed... 404" means nothing plays at all. Reporting it only on the ad
  // tracker hides the integration's most severe failure from content error and
  // startup-failure analysis, because goError() sets hadStartupError only for
  // non-ad trackers.
  it('ERROR is reported on the content tracker, not just as an ad error', () => {
    const sm = createMockStreamManager();
    const contentTracker = { sendError: jest.fn(), getBitrate: () => null };
    const tracker = new DaiTracker(sm, { tag: createMockTag(), contentTracker });
    jest.spyOn(tracker, 'sendError');

    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'Stream initialization failed. 404' }),
    });

    expect(contentTracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'Stream initialization failed. 404' })
    );
    // No ad break is open, so this is purely a content failure.
    expect(tracker.sendError).not.toHaveBeenCalled();
  });

  it('ERROR during an ad break is reported as both an ad and a content error', () => {
    const sm = createMockStreamManager();
    const contentTracker = { sendError: jest.fn(), getBitrate: () => null };
    const tracker = new DaiTracker(sm, { tag: createMockTag(), contentTracker });
    jest.spyOn(tracker, 'sendError');

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'mid-break failure' }),
    });

    expect(tracker.sendError).toHaveBeenCalled();
    expect(contentTracker.sendError).toHaveBeenCalled();
  });

  it('ERROR still reports on itself when no content tracker is wired', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'orphan failure' }),
    });
    expect(tracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'orphan failure' })
    );
  });

  // The SDK's errorMessage embeds the full DAI request URL. Its query string
  // carries identifiers — ua, uach, sid, and in real integrations ppid and
  // cust_params — and video-core's obfuscation rules are opt-in per integrator,
  // so shipping it verbatim puts user identifiers in NRDB by default.
  it('strips the query string from URLs in the SDK error message', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({
        errorMessage:
          'Stream initialization failed. HTTP status code: 404 with URL: ' +
          'https://pubads.g.doubleclick.net/ondemand/hls/content/1/vid/x/streams' +
          '?ppid=user-4821&cust_params=uid%3D99&ua=Mozilla%2F5.0&sid=ABC-123',
      }),
    });
    const { errorMessage } = tracker.sendError.mock.calls[0][0];
    expect(errorMessage).toContain('HTTP status code: 404');
    expect(errorMessage).toContain('/ondemand/hls/content/1/vid/x/streams');
    expect(errorMessage).not.toContain('ppid');
    expect(errorMessage).not.toContain('cust_params');
    expect(errorMessage).not.toContain('user-4821');
    expect(errorMessage).not.toContain('sid=');
  });

  it('caps a runaway error message', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'x'.repeat(5000) }),
    });
    const { errorMessage } = tracker.sendError.mock.calls[0][0];
    expect(errorMessage.length).toBeLessThanOrEqual(512);
  });

  it('leaves a plain error message untouched', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'The stream is inactive.' }),
    });
    expect(tracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'The stream is inactive.' })
    );
  });

  it('ERROR with a throwing event object falls back to a generic message, not a crash', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    const throwingEvent = { getStreamData: () => { throw new Error('boom'); } };
    expect(() => sm._emit(StreamEventType.ERROR, throwingEvent)).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'Unknown DAI error' })
    );
  });

  it('CUEPOINTS_CHANGED reads cue points from StreamData', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const cuepoints = [
      { start: 0, end: 10.01, played: false },
      { start: 79.927, end: 89.937, played: false },
    ];
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints }) });
    expect(tracker.getAdCuePoints()).toEqual(cuepoints);
  });

  it('does not clobber known cue points when a later event carries none', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const cuepoints = [{ start: 0, end: 10.01, played: false }];
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints }) });
    // LOADED carries cuepoints: null on the live SDK.
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints: null }) });
    expect(tracker.getAdCuePoints()).toEqual(cuepoints);
  });

  // AD_BREAK_STARTED arrives after playback has already entered the ad, so the
  // break object alone cannot tell us an ad is on screen at the first
  // timeupdate. The cue points, known from CUEPOINTS_CHANGED, can.
  it('knows an ad is playing inside a cue point window before the break is announced', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(0.2) });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: false }] }),
    });
    expect(tracker.getCurrentAdBreak()).toBeNull();
    expect(tracker.isAdPlaying()).toBe(true);
  });

  // cuePoints gates content events since the pre-roll guard was added, so a
  // list left over from a previous stream would treat real content as an ad.
  // CUEPOINTS_CHANGED never fires for an ad-free stream, so LOADED must reset.
  // Verified live event order, per stream:
  //   STREAM_INITIALIZED -> CUEPOINTS_CHANGED -> LOADED -> ... -> CUEPOINTS_CHANGED
  // Cue points arrive BEFORE their own LOADED, and again mid-stream when the
  // played flags update. So LOADED is the wrong reset point under any key, and
  // a "did cue points arrive" flag is defeated by the mid-stream event.
  // STREAM_INITIALIZED is the only point that precedes a stream's cue points.
  function startStream(sm, url, { withCuePoints = true } = {}) {
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    if (withCuePoints) {
      sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
        getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: false }] }),
      });
    }
    sm._emit(StreamEventType.LOADED, {
      getStreamData: () => ({ streamId: url, url, cuepoints: null }),
    });
  }

  it('keeps cue points that arrived before the stream they belong to loaded', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    startStream(sm, 'https://x/master.m3u8');
    expect(tracker.getAdCuePoints()).toHaveLength(1);
    expect(tracker.isAdPlaying()).toBe(true);
  });

  it('keeps the second stream\'s cue points too, not just the first\'s', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    startStream(sm, 'https://x/master.m3u8');
    startStream(sm, 'https://y/master.m3u8');
    expect(tracker.getAdCuePoints()).toHaveLength(1);
    expect(tracker.isAdPlaying()).toBe(true);
  });

  it('forgets the previous stream\'s cue points when an ad-free stream follows', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    startStream(sm, 'https://x/master.m3u8');
    expect(tracker.isAdPlaying()).toBe(true);

    // CUEPOINTS_CHANGED never fires for a stream with no ads.
    startStream(sm, 'https://y/master.m3u8', { withCuePoints: false });
    expect(tracker.getAdCuePoints()).toEqual([]);
    expect(tracker.isAdPlaying()).toBe(false);
  });

  it('is not confused by the mid-stream CUEPOINTS_CHANGED the SDK also fires', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    startStream(sm, 'https://x/master.m3u8');
    // Fires again at break start to update played flags.
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: true }] }),
    });
    // Now an ad-free stream: its cue points must still be dropped.
    startStream(sm, 'https://y/master.m3u8', { withCuePoints: false });
    expect(tracker.getAdCuePoints()).toEqual([]);
    expect(tracker.isAdPlaying()).toBe(false);
  });

  it('forgets ad and break state when a new stream initializes', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startStream(sm, 'https://x/master.m3u8');
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    startStream(sm, 'https://y/master.m3u8', { withCuePoints: false });
    expect(tracker.getCurrentAd()).toBeNull();
    expect(tracker.getCurrentAdBreak()).toBeNull();
    expect(tracker.getVideoId()).toBeNull();
  });

  it('does not treat an already-played cue point window as an ad', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(5) });
    // Seeking back into a watched pre-roll: the window is marked played, and
    // no ad telemetry will accompany it, so content must keep reporting.
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: true }] }),
    });
    expect(tracker.isAdPlaying()).toBe(false);
  });

  it('knows content is playing once the stream time leaves every cue point window', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(42) });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: true }] }),
    });
    expect(tracker.isAdPlaying()).toBe(false);
  });

  it('reports an ad is playing whenever a break is open, cue points or not', () => {
    const sm = createMockStreamManager();
        const tracker = new DaiTracker(sm, { tag: createMockTag(500) });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.isAdPlaying()).toBe(true);
  });

  it('does not hand its internal break state to the telemetry layer', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    // video-core's getAttributes() fills and returns the very object it is
    // given, so passing internal state by reference lets it be overwritten.
    jest.spyOn(tracker, 'sendAdBreakStart').mockImplementation((att) => {
      att.trackerName = 'injected';
      att.viewId = 'injected';
    });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.getCurrentAdBreak()).not.toHaveProperty('trackerName');
    expect(tracker.getCurrentAdBreak()).not.toHaveProperty('viewId');
  });
});

describe('DaiTracker — ad playback events', () => {
  // Mirrors the real IMA DAI Ad object: note there is deliberately NO
  // getClickThroughUrl — the live SDK does not define one, and calling it
  // unguarded used to throw and wipe every ad attribute.
  function makeAd(overrides = {}) {
    return {
      getAdId: () => 'ad1',
      getCreativeId: () => 'c1',
      getDuration: () => 15,
      getTitle: () => 'My Ad',
      getAdPodInfo: () => ({ getPodIndex: () => 0 }),
      ...overrides,
    };
  }

  function startAd(tracker, sm, adOverrides = {}) {
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [{}] }) });
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd(adOverrides) });
  }

  it('extracts ad identity even though the SDK has no getClickThroughUrl', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm);
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getAdCreativeId()).toBe('c1');
    expect(tracker.getTitle()).toBe('My Ad');
    expect(tracker.getDuration()).toBe(15000);
  });

  it('survives an Ad object whose optional accessors all throw', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const hostile = {
      getAdId: () => 'ad9',
      getCreativeId: () => { throw new Error('nope'); },
      getDuration: () => { throw new Error('nope'); },
      getTitle: () => { throw new Error('nope'); },
      getAdPodInfo: () => { throw new Error('nope'); },
    };
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    expect(() => sm._emit(StreamEventType.STARTED, { getAd: () => hostile })).not.toThrow();
    // The one accessor that works must still come through.
    expect(tracker.getVideoId()).toBe('ad9');
  });

  it.each([
    [0, 'pre'],
    [2, 'mid'],
    [-1, 'post'],
  ])('derives adPosition from IMA pod index %i -> "%s"', (podIndex, expected) => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm, { getAdPodInfo: () => ({ getPodIndex: () => podIndex }) });
    expect(tracker.getAdPosition()).toBe(expected);
  });

  it('reports the real ad count from the IMA ad pod, not 0', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm, {
      getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 3 }),
    });
    expect(tracker.getCurrentAdBreak().adCount).toBe(3);
  });

  it('leaves adCount unset rather than reporting 0 when the pod is unavailable', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.getCurrentAdBreak()).not.toBeNull(); // the content guard depends on this
    expect(tracker.getCurrentAdBreak().adCount).toBeUndefined();
  });

  it('keeps adPosition stable for the whole ad as the stream time advances', () => {
    const sm = createMockStreamManager();
    const tag = createMockTag();
    const tracker = new DaiTracker(sm, { tag });
    startAd(tracker, sm, { getAdPodInfo: () => ({ getPodIndex: () => 0 }) });
    expect(tracker.getAdPosition()).toBe('pre');
    // A DAI pre-roll advances the stitched stream's currentTime past any
    // time-based 'pre' threshold; position must not drift to 'mid'.
    tag.currentTime = 9.5;
    expect(tracker.getAdPosition()).toBe('pre');
  });

  it('STARTED extracts ad data and calls sendStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendStart');
    startAd(tracker, sm);
    expect(tracker.sendStart).toHaveBeenCalled();
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getTitle()).toBe('My Ad');
  });

  it.each([
    [StreamEventType.FIRST_QUARTILE, 1],
    [StreamEventType.MIDPOINT, 2],
    [StreamEventType.THIRD_QUARTILE, 3],
  ])('%s calls sendAdQuartile({ quartile: %i })', (type, quartile) => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdQuartile');
    startAd(tracker, sm);
    sm._emit(type, {});
    expect(tracker.sendAdQuartile).toHaveBeenCalledWith({ quartile });
  });

  it('COMPLETE calls sendEnd() and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.COMPLETE, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith();
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('SKIPPED calls sendEnd({ skipped: true }) and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.SKIPPED, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith({ skipped: true });
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('PAUSED calls sendPause(), RESUMED calls sendResume()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendPause');
    jest.spyOn(tracker, 'sendResume');
    startAd(tracker, sm);
    sm._emit(StreamEventType.PAUSED, {});
    sm._emit(StreamEventType.RESUMED, {});
    expect(tracker.sendPause).toHaveBeenCalled();
    expect(tracker.sendResume).toHaveBeenCalled();
  });

  // The DAI Ad object exposes no clickthrough URL, so AD_CLICK still reports
  // that a click happened but carries a null url rather than inventing one.
  // The DAI Ad object has no clickthrough accessor, so passing url: null would
  // trip video-core's "Called sendAdClick without { url: xxxxx }" warning on
  // every single click. Omit the key instead of asserting a value we know we
  // do not have.
  it.each([StreamEventType.CLICK, StreamEventType.VIDEO_CLICKED])(
    '%s reports an ad click without a url key when the SDK provides none',
    (type) => {
      const sm = createMockStreamManager();
      const tracker = new DaiTracker(sm, { tag: createMockTag() });
      jest.spyOn(tracker, 'sendAdClick');
      startAd(tracker, sm);
      sm._emit(type, {});
      expect(tracker.sendAdClick).toHaveBeenCalledWith({});
    }
  );

  it('picks up a clickthrough url if a future SDK version provides one', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdClick');
    startAd(tracker, sm, { getClickThroughUrl: () => 'https://advertiser.example' });
    sm._emit(StreamEventType.CLICK, {});
    expect(tracker.sendAdClick).toHaveBeenCalledWith({ url: 'https://advertiser.example' });
  });

  // video-core gates AD_START on state.isRequested, and clears that flag on
  // both AD_END and AD_BREAK_END. So every ad must open with its own
  // sendRequest(), or only the session's first ad ever reports a start/end.
  it('requests before every ad start, not once per stream', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const calls = [];
    jest.spyOn(tracker, 'sendRequest').mockImplementation(() => calls.push('request'));
    jest.spyOn(tracker, 'sendStart').mockImplementation(() => calls.push('start'));
    jest.spyOn(tracker, 'sendEnd').mockImplementation(() => calls.push('end'));

    // Two ads in one pod, then a second break with one more.
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => 'ad2' }) });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => 'ad3' }) });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(calls).toEqual([
      'request', 'start', 'end',
      'request', 'start', 'end',
      'request', 'start', 'end',
    ]);
  });

  it('ends an ad that is still in flight when its break ends', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const order = [];
    jest.spyOn(tracker, 'sendEnd').mockImplementation(() => order.push('end'));
    jest.spyOn(tracker, 'sendAdBreakEnd').mockImplementation(() => order.push('breakEnd'));

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.AD_BREAK_ENDED, {}); // no COMPLETE

    expect(order).toEqual(['end', 'breakEnd']);
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('does not double-end an ad that already completed', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.COMPLETE, {});
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendEnd).not.toHaveBeenCalled();
  });

  it('a second ad break does not see stale data from the first', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    startAd(tracker, sm, { getAdId: () => 'ad1' });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    startAd(tracker, sm, { getAdId: () => 'ad2' });
    expect(tracker.getVideoId()).toBe('ad2');
  });
});

describe('DaiTracker — cue points, metadata, getters', () => {
  it('CUEPOINTS_CHANGED updates getAdCuePoints() without sending anything', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const sends = [
      'sendRequest', 'sendStart', 'sendEnd', 'sendAdBreakStart', 'sendAdBreakEnd',
      'sendAdQuartile', 'sendAdClick', 'sendError', 'sendDownload',
    ];
    sends.forEach((m) => jest.spyOn(tracker, m));
    const cuepoints = [{ start: 0, end: 10.01, played: false }];
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints }) });
    expect(tracker.getAdCuePoints()).toEqual(cuepoints);
    sends.forEach((m) => expect(tracker[m]).not.toHaveBeenCalled());
  });

  // TIMED_METADATA is deliberately not subscribed: its payload is not reachable
  // from a StreamEvent (no getType/getData on the live prototype), nothing read
  // the value, and in DAI timed metadata flows INTO the SDK rather than out.
  it('does not subscribe to TIMED_METADATA', () => {
    const sm = createMockStreamManager();
    new DaiTracker(sm, { tag: createMockTag() });
    const subscribed = sm.addEventListener.mock.calls.map(([type]) => type);
    expect(subscribed).not.toContain(StreamEventType.TIMED_METADATA);
  });

  // Stream time comes from the media element: under SSAI the stitched stream's
  // own clock is the stream timeline, and the live StreamManager has no
  // getStreamTime() to ask.
  it('getPlayhead() reports stream time from the media element, in ms', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag(12.3) });
    expect(tracker.getPlayhead()).toBe(12300);
  });

  // The content tracker asks for this so it can report contentPlayhead in
  // content time rather than stream time.
  it('converts stream time to content time via the StreamManager', () => {
    const sm = createMockStreamManager();
    sm.contentTimeForStreamTime = jest.fn((streamTime) => streamTime - 10);
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.contentTimeForStreamTime(30)).toBe(20);
    expect(sm.contentTimeForStreamTime).toHaveBeenCalledWith(30);
  });

  it('returns undefined from the conversion when the SDK cannot do it', () => {
    const sm = createMockStreamManager();
    delete sm.contentTimeForStreamTime;
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.contentTimeForStreamTime(30)).toBeUndefined();
  });

  it('does not throw from the conversion after being disposed', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    tracker.dispose();
    expect(() => tracker.contentTimeForStreamTime(30)).not.toThrow();
    expect(tracker.contentTimeForStreamTime(30)).toBeUndefined();
  });

  it('getPlayhead() does not consult the StreamManager', () => {
    const sm = createMockStreamManager();
    sm.getStreamTime = jest.fn();
    const tracker = new DaiTracker(sm, { tag: createMockTag(7) });
    expect(tracker.getPlayhead()).toBe(7000);
    expect(sm.getStreamTime).not.toHaveBeenCalled();
  });

  it('getStreamType() infers "live" from Infinity duration, "vod" otherwise', () => {
    const live = new DaiTracker(createMockStreamManager(), { tag: { ...createMockTag(), duration: Infinity } });
    const vod = new DaiTracker(createMockStreamManager(), { tag: createMockTag() });
    expect(live.getStreamType()).toBe('live');
    expect(vod.getStreamType()).toBe('vod');
    expect(live.isLiveStream()).toBe(true);
  });

  it('isMuted() reflects tag.muted', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: { ...createMockTag(), muted: true } });
    expect(tracker.isMuted()).toBe(true);
  });

  it('getBitrate()/getRenditionBitrate() delegate to options.contentTracker when provided', () => {
    const sm = createMockStreamManager();
    const contentTracker = { getBitrate: jest.fn(() => 512000) };
    const tracker = new DaiTracker(sm, { tag: createMockTag(), contentTracker });
    expect(tracker.getBitrate()).toBe(512000);
    expect(tracker.getRenditionBitrate()).toBe(512000);
  });

  // The stitched stream is decoded by the same hls.js instance during an ad, so
  // rendition comes from the content tracker exactly as bitrate does. These
  // returned a hardcoded null while getBitrate delegated.
  it('getRenditionHeight/Width delegate to the content tracker', () => {
    const sm = createMockStreamManager();
    const contentTracker = {
      getBitrate: () => 512000,
      getRenditionHeight: () => 720,
      getRenditionWidth: () => 1280,
      getRenditionName: () => '720p',
    };
    const tracker = new DaiTracker(sm, { tag: createMockTag(), contentTracker });
    expect(tracker.getRenditionHeight()).toBe(720);
    expect(tracker.getRenditionWidth()).toBe(1280);
    expect(tracker.getRenditionName()).toBe('720p');
  });

  it('rendition getters return null without a content tracker', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.getRenditionHeight()).toBeNull();
    expect(tracker.getRenditionWidth()).toBeNull();
    expect(tracker.getRenditionName()).toBeNull();
  });

  it('getBitrate() returns null when no contentTracker is provided', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.getBitrate()).toBeNull();
  });

  // isUsing() was removed: it had no consumers (hls.js has no tech
  // auto-detection, unlike the video.js trackers), and it tested for a
  // getStreamTime() the real StreamManager does not have — so it would have
  // returned false for the very object it was meant to detect.
  it('does not expose an isUsing() detector', () => {
    expect(DaiTracker.isUsing).toBeUndefined();
  });
});

// The shared @newrelic/video-core mock lets every send* through, so it cannot
// catch events the real base class silently swallows. These tests replay
// video-core 5.1.1's actual gating — goStart() requires isRequested, and both
// goEnd() and goAdBreakEnd() clear it — which is what hid the bug where only
// the first ad of a session reported a start.
describe('DaiTracker — against video-core\'s real event gating', () => {
  function gatedTracker() {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const state = { isRequested: false, isStarted: false, isAdBreak: false };
    const reported = [];

    tracker.sendRequest = () => {
      if (state.isRequested) return;
      state.isRequested = true;
      reported.push('AD_REQUEST');
    };
    tracker.sendStart = () => {
      if (!state.isRequested || state.isStarted) return;
      state.isStarted = true;
      reported.push('AD_START');
    };
    tracker.sendEnd = () => {
      if (!state.isRequested) return;
      state.isRequested = false;
      state.isStarted = false;
      reported.push('AD_END');
    };
    tracker.sendAdBreakStart = () => {
      if (state.isAdBreak) return;
      state.isAdBreak = true;
      reported.push('AD_BREAK_START');
    };
    tracker.sendAdBreakEnd = () => {
      if (!state.isAdBreak) return;
      state.isAdBreak = false;
      state.isRequested = false;
      reported.push('AD_BREAK_END');
    };
    tracker.sendAdQuartile = ({ quartile }) => reported.push(`AD_QUARTILE${quartile}`);

    return { sm, tracker, reported };
  }

  function playAd(sm, adId) {
    sm._emit(StreamEventType.STARTED, {
      getAd: () => ({
        getAdId: () => adId,
        getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 2 }),
      }),
    });
    sm._emit(StreamEventType.FIRST_QUARTILE, {});
    sm._emit(StreamEventType.COMPLETE, {});
  }

  // goAdBreakEnd() clears isRequested but NOT isStarted; only goEnd() (via
  // sendEnd) resets that. So an ad still in flight when its break ends — a seek
  // out of a mid-roll, an ad error — would otherwise block AD_START for every
  // later ad in the session.
  it('still reports later ads when an earlier ad never completed', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, {
      getAd: () => ({ getAdId: () => 'ad1', getAdPodInfo: () => ({ getPodIndex: () => 0 }) }),
    });
    sm._emit(StreamEventType.AD_BREAK_ENDED, {}); // no COMPLETE for ad1
    const mark = reported.length;

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    const second = reported.slice(mark);
    expect(second).toContain('AD_START');
    expect(second.indexOf('AD_START')).toBeLessThan(second.indexOf('AD_QUARTILE1'));
  });

  it('reports a start and an end for every ad in a multi-ad pod', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(reported.filter((e) => e === 'AD_START')).toHaveLength(2);
    expect(reported.filter((e) => e === 'AD_END')).toHaveLength(2);
    expect(reported).not.toContain('AD_QUARTILE1_ORPHAN');
  });

  it('still reports ads in a later break after the first break ended', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(reported).toEqual([
      'AD_BREAK_START', 'AD_REQUEST', 'AD_START', 'AD_QUARTILE1', 'AD_END', 'AD_BREAK_END',
      'AD_BREAK_START', 'AD_REQUEST', 'AD_START', 'AD_QUARTILE1', 'AD_END', 'AD_BREAK_END',
    ]);
  });

  it('never emits a quartile for an ad that never reported a start', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    // One quartile per ad, each preceded by that ad's own start.
    const starts = reported.filter((e) => e === 'AD_START').length;
    const quartiles = reported.filter((e) => e.startsWith('AD_QUARTILE')).length;
    expect(quartiles).toBe(starts);
  });
});
