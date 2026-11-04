import DaiTracker from '../../ads/dai';

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

beforeEach(() => {
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    getStreamTime: jest.fn(() => 12.3),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockTag() {
  return { currentTime: 3, duration: 120, muted: false };
}

describe('DaiTracker — construction & lifecycle', () => {
  it('registers a listener for every StreamEvent.Type on construction', () => {
    const sm = createMockStreamManager();
    new DaiTracker(sm, { tag: createMockTag() });
    expect(sm.addEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('removes all listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    tracker.unregisterListeners();
    expect(sm.removeEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('LOADED extracts stream data and calls sendRequest()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendRequest');
    const event = { getStreamData: () => ({ streamId: 's1', url: 'https://x/master.m3u8', adTagParameters: {} }) };
    sm._emit(StreamEventType.LOADED, event);
    expect(tracker.sendRequest).toHaveBeenCalled();
    expect(tracker.getSrc()).toBe('https://x/master.m3u8');
  });

  it('STREAM_INITIALIZED calls sendDownload({ state: "stream-initialized" })', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendDownload');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendDownload).toHaveBeenCalledWith({ state: 'stream-initialized' });
  });

  // The live DAI StreamEvent has no getAdBreak() — only getAd, getAdUi,
  // getCustomAdUi, getStreamData, preventDefault — so a break opens with no
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
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledWith(
      expect.objectContaining({ adCount: 2, position: 'pre' })
    );
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

  it('AD_PERIOD_ENDED does not end the break or send anything (more ads may follow)', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  it('ERROR with a throwing event object falls back to a generic message, not a crash', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendError');
    const throwingEvent = { getError: () => { throw new Error('boom'); } };
    expect(() => sm._emit(StreamEventType.ERROR, throwingEvent)).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'Unknown DAI error' }));
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
  it.each([StreamEventType.CLICK, StreamEventType.VIDEO_CLICKED])(
    '%s reports an ad click with a null url (none available from the SDK)',
    (type) => {
      const sm = createMockStreamManager();
      const tracker = new DaiTracker(sm, { tag: createMockTag() });
      jest.spyOn(tracker, 'sendAdClick');
      startAd(tracker, sm);
      sm._emit(type, {});
      expect(tracker.sendAdClick).toHaveBeenCalledWith({ url: null });
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
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getCuepoints: () => [10, 30, -1] });
    expect(tracker.getAdCuePoints()).toEqual([10, 30, -1]);
  });

  it('TIMED_METADATA extracts type/data without sending anything', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    const sends = [
      'sendRequest', 'sendStart', 'sendEnd', 'sendAdBreakStart', 'sendAdBreakEnd',
      'sendAdQuartile', 'sendAdClick', 'sendError', 'sendDownload', 'sendPause', 'sendResume',
    ];
    sends.forEach((m) => jest.spyOn(tracker, m));
    sm._emit(StreamEventType.TIMED_METADATA, { getType: () => 'ID3', getData: () => ({ cue: 'x' }) });
    sends.forEach((m) => expect(tracker[m]).not.toHaveBeenCalled());
  });

  it('getPlayhead() uses streamManager.getStreamTime() when available', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.getPlayhead()).toBe(12300); // 12.3 * 1000, from createMockStreamManager
  });

  it('getPlayhead() falls back to tag.currentTime when getStreamTime throws', () => {
    const sm = createMockStreamManager();
    sm.getStreamTime = jest.fn(() => { throw new Error('not ready'); });
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.getPlayhead()).toBe(3000); // tag.currentTime (3) * 1000
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

  it('getBitrate() returns null when no contentTracker is provided', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    expect(tracker.getBitrate()).toBeNull();
  });

  it('DaiTracker.isUsing() detects a StreamManager-shaped object', () => {
    expect(DaiTracker.isUsing(createMockStreamManager())).toBe(true);
    expect(DaiTracker.isUsing({})).toBe(false);
    expect(DaiTracker.isUsing(null)).toBe(false);
  });
});
