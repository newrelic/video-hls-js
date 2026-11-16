import Hls from 'hls.js';
import nrvideo from '@newrelic/video-core';
import HLSTracker, { AD_TRACKING } from '../tracker';
import DaiAdsTracker from '../ads/dai';

// The video-core jest mock is minimal: stub what DAI tracking relies on.
const proto = nrvideo.VideoTracker.prototype;
proto.setIsAd = jest.fn();
proto.sendAdBreakStart = jest.fn();
proto.sendAdBreakEnd = jest.fn();
proto.setAdsTracker = function (t) { this.adsTracker = t; };

const EVT = {
  LOADED: 'loaded',
  STREAM_INITIALIZED: 'streamInitialized',
  ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted',
  AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted',
  AD_PERIOD_ENDED: 'adPeriodEnded',
  STARTED: 'started',
  FIRST_QUARTILE: 'firstquartile',
  MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdquartile',
  COMPLETE: 'complete',
  SKIPPED: 'skipped',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  CLICK: 'click',
  VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged',
};

const makeStreamManager = () => {
  const handlers = {};
  return {
    handlers,
    addEventListener: jest.fn((t, h) => { handlers[t] = h; }),
    removeEventListener: jest.fn((t) => { delete handlers[t]; }),
    processMetadata: jest.fn(),
  };
};

const makeAd = (podOffset = 0) => ({
  getAdId: () => 'ad-1',
  getCreativeId: () => 'cr-1',
  getDuration: () => 15,
  getTitle: () => 'Title',
  getDescription: () => 'Desc',
  getAdvertiserName: () => 'Acme',
  getClickThroughUrl: () => 'https://acme.test',
  getDealId: () => 'deal',
  getWrapperAdIds: () => [],
  getAdPodInfo: () => ({ getTimeOffset: () => podOffset }),
});

const makeVideo = () => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  currentTime: 30,
  duration: Infinity,
  muted: false,
});

const makeHls = (video) => ({
  on: jest.fn(),
  off: jest.fn(),
  levels: [],
  currentLevel: 0,
  media: video,
  constructor: Hls,
});

const options = (ad) => ({
  info: { beacon: 'https://example.com', licenseKey: 'k', applicationID: 'a' },
  config: ad ? { ad } : undefined,
});

describe('DaiAdsTracker', () => {
  let sm, video, hls, ads;

  beforeEach(() => {
    global.google = { ima: { dai: { api: { StreamEvent: { Type: EVT }, VERSION: '3.0' } } } };
    sm = makeStreamManager();
    video = makeVideo();
    hls = makeHls(video);
    ads = new DaiAdsTracker(hls, { tag: video });
    ads.tag = video; // mock ctor sets tag = player
    ads.setStreamManager(sm);
  });

  afterEach(() => { delete global.google; });

  it('registers all StreamManager listeners', () => {
    expect(Object.keys(sm.handlers)).toEqual(expect.arrayContaining([
      EVT.LOADED, EVT.AD_BREAK_STARTED, EVT.STARTED, EVT.COMPLETE, EVT.ERROR,
    ]));
  });

  it('removes listeners on unregister', () => {
    ads.unregisterListeners();
    expect(Object.keys(sm.handlers)).toHaveLength(0);
  });

  it('maps ad started to ad data used by getters', () => {
    video.duration = 600;
    sm.handlers[EVT.STARTED]({ getAd: () => makeAd(0) });
    expect(ads.getVideoId()).toBe('ad-1');
    expect(ads.getAdCreativeId()).toBe('cr-1');
    expect(ads.getTitle()).toBe('Title');
    expect(ads.getDuration()).toBe(15000);
    expect(ads.getAdPosition()).toBe('pre');
    expect(ads.getAdPartner()).toBe('google-dai');
  });

  it.each([[0, 'pre'], [-1, 'post'], [120, 'mid']])('vod pod offset %s => %s', (offset, pos) => {
    video.duration = 600;
    sm.handlers[EVT.STARTED]({ getAd: () => makeAd(offset) });
    expect(ads.currentAdData.position).toBe(pos);
  });

  it('ignores pod offset on live (finite duration) and uses hls liveSyncPosition', () => {
    video.duration = 900;
    video.currentTime = 50;
    hls.liveSyncPosition = 880;
    sm.handlers[EVT.STARTED]({ getAd: () => makeAd(0) });
    expect(ads.getStreamType()).toBe('live');
    expect(ads.getAdPosition()).toBe('mid');
  });

  it('sends quartiles 1..3', () => {
    const spy = jest.spyOn(ads, 'sendAdQuartile');
    sm.handlers[EVT.FIRST_QUARTILE]();
    sm.handlers[EVT.MIDPOINT]();
    sm.handlers[EVT.THIRD_QUARTILE]();
    expect(spy.mock.calls.map((c) => c[0].quartile)).toEqual([1, 2, 3]);
  });

  it('clears ad data on complete and sends skipped flag on skip', () => {
    const end = jest.spyOn(ads, 'sendEnd');
    sm.handlers[EVT.STARTED]({ getAd: () => makeAd() });
    sm.handlers[EVT.SKIPPED]();
    expect(end).toHaveBeenCalledWith({ skipped: true });
    expect(ads.currentAdData).toBeNull();
  });

  it('maps stream error to sendError', () => {
    const spy = jest.spyOn(ads, 'sendError');
    sm.handlers[EVT.ERROR]({
      getError: () => ({ getErrorCode: () => 1010, getMessage: () => 'bad', getInnerError: () => null }),
    });
    expect(spy).toHaveBeenCalledWith({ errorCode: 1010, errorMessage: 'bad', innerError: null });
  });

  it('starts a break from ad period when no break open', () => {
    const spy = jest.spyOn(ads, 'sendAdBreakStart');
    sm.handlers[EVT.AD_PERIOD_STARTED]({});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('requests before every ad start (core resets request on each end)', () => {
    const req = jest.spyOn(ads, 'sendRequest');
    const start = jest.spyOn(ads, 'sendStart');
    [1, 2, 3].forEach(() => {
      sm.handlers[EVT.STARTED]({ getAd: () => makeAd() });
      sm.handlers[EVT.COMPLETE]();
    });
    expect(req).toHaveBeenCalledTimes(3);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('still extracts ad data when some Ad getters are missing', () => {
    video.duration = 600;
    const ad = makeAd();
    delete ad.getClickThroughUrl;
    ad.getTitle = () => { throw new Error('boom'); };
    sm.handlers[EVT.STARTED]({ getAd: () => ad });
    expect(ads.getVideoId()).toBe('ad-1');
    expect(ads.getAdCreativeId()).toBe('cr-1');
    expect(ads.getAdPosition()).toBe('pre');
  });

  it('detects live vs vod from duration', () => {
    expect(ads.getStreamType()).toBe('live');
    video.duration = 100;
    expect(ads.getStreamType()).toBe('vod');
  });
});

describe('HLSTracker.setStreamManager', () => {
  let sm, video, hls;

  beforeEach(() => {
    global.google = { ima: { dai: { api: { StreamEvent: { Type: EVT } } } } };
    sm = makeStreamManager();
    video = makeVideo();
    hls = makeHls(video);
  });

  afterEach(() => { delete global.google; });

  it('ignores the call when config.ad.type is not DAI', () => {
    const tracker = new HLSTracker(hls, options());
    tracker.setStreamManager(sm);
    expect(tracker.adsTracker).toBeFalsy();
  });

  it('attaches DaiAdsTracker and forwards ID3 when DAI configured', () => {
    const tracker = new HLSTracker(hls, options({ type: AD_TRACKING.SSAI.DAI }));
    tracker.setStreamManager(sm);
    expect(tracker.adsTracker).toBeInstanceOf(DaiAdsTracker);

    const call = hls.on.mock.calls.find((c) => c[0] === Hls.Events.FRAG_PARSING_METADATA);
    call[1]('evt', { samples: [{ data: new Uint8Array([1]), pts: 5 }] });
    expect(sm.processMetadata).toHaveBeenCalledWith('ID3', expect.any(Uint8Array), 5);
  });

  it('does not forward ID3 when processId3 is false', () => {
    const tracker = new HLSTracker(hls, options({ type: AD_TRACKING.SSAI.DAI, processId3: false }));
    tracker.setStreamManager(sm);
    expect(hls.on.mock.calls.some((c) => c[0] === Hls.Events.FRAG_PARSING_METADATA)).toBe(false);
  });

  it('removes the ID3 listener on unregisterListeners', () => {
    const tracker = new HLSTracker(hls, options({ type: AD_TRACKING.SSAI.DAI }));
    tracker.tag = video;
    tracker.setStreamManager(sm);
    tracker.unregisterListeners();
    expect(hls.off).toHaveBeenCalledWith(Hls.Events.FRAG_PARSING_METADATA, expect.any(Function));
  });
});
