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

  it('AD_BREAK_STARTED extracts break data and calls sendAdBreakStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    const event = { getAdBreak: () => ({ id: 'b1', title: 'Break 1', ads: [{}, {}] }) };
    sm._emit(StreamEventType.AD_BREAK_STARTED, event);
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toEqual(expect.objectContaining({ adBreakId: 'b1' }));
  });

  it('AD_BREAK_ENDED calls sendAdBreakEnd() and clears the current break', () => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: createMockTag() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
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
  function startAd(tracker, sm, adOverrides = {}) {
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [{}] }) });
    sm._emit(StreamEventType.STARTED, {
      getAd: () => ({
        getAdId: () => 'ad1',
        getCreativeId: () => 'c1',
        getDuration: () => 15,
        getTitle: () => 'My Ad',
        getClickThroughUrl: () => 'https://x',
        ...adOverrides,
      }),
    });
  }

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

  it.each([StreamEventType.CLICK, StreamEventType.VIDEO_CLICKED])(
    '%s calls sendAdClick with the click-through url',
    (type) => {
      const sm = createMockStreamManager();
      const tracker = new DaiTracker(sm, { tag: createMockTag() });
      jest.spyOn(tracker, 'sendAdClick');
      startAd(tracker, sm);
      sm._emit(type, {});
      expect(tracker.sendAdClick).toHaveBeenCalledWith({ url: 'https://x' });
    }
  );

  it.each([
    [2, 'pre'],
    [60, 'mid'],
    [117, 'post'], // duration (120) - 10 < currentTime
  ])('classifies ad position at currentTime %i as "%s"', (currentTime, expected) => {
    const sm = createMockStreamManager();
    const tracker = new DaiTracker(sm, { tag: { ...createMockTag(), currentTime, duration: 120 } });
    startAd(tracker, sm);
    expect(tracker.getCurrentAd().position).toBe(expected);
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
