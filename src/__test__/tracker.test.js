import HLSTracker from '../tracker';
import { version } from '../../package.json';
import Hls from 'hls.js';

const mockHlsInstance = {
  currentLevel: 0,
  levels: [
    {
      bitrate: 258157,
      width: 426,
      height: 180,
      name: '180'
    },
    {
      bitrate: 512345,
      width: 640,
      height: 240,
      name: '240'
    },
    {
      bitrate: 987654,
      width: 854,
      height: 360,
      name: '360'
    }
  ],
  on: jest.fn(),
  off: jest.fn(),
  playbackRate: 1,
  autoplay: false,
  preload: 'auto',
  media: null,
  networkState: 2,
  readyState: 4,
  NETWORK_LOADING: 2,
  HAVE_FUTURE_DATA: 3,
  constructor: Hls,
};

const mockVideoElement = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  currentTime: 10,
  duration: 100,
  currentSrc: 'https://example.com/stream.m3u8',
  muted: false,
  playbackRate: 1
};

describe('HLSTracker', () => {
  let tracker;

  beforeEach(() => {
    // Reset all properties that individual tests may mutate
    mockHlsInstance.currentLevel = 0;
    mockHlsInstance.levels = [
      { bitrate: 258157, width: 426, height: 180, name: '180' },
      { bitrate: 512345, width: 640, height: 240, name: '240' },
      { bitrate: 987654, width: 854, height: 360, name: '360' },
    ];
    mockHlsInstance.playbackRate = 1;
    mockHlsInstance.autoplay = false;
    mockHlsInstance.preload = 'auto';
    mockHlsInstance.bandwidthEstimate = undefined;
    mockHlsInstance.error = undefined;
    mockHlsInstance.networkState = 2;
    mockHlsInstance.readyState = 4;
    mockHlsInstance.NETWORK_LOADING = 2;
    mockHlsInstance.HAVE_FUTURE_DATA = 3;
    // Provide media so VideoTracker.setPlayer resolves the tag correctly
    // instead of falling back to the HLS player instance
    mockHlsInstance.media = mockVideoElement;
    tracker = new HLSTracker(mockHlsInstance, {
      info: {
        beacon: 'https://example.com/beacon',
        licenseKey: 'test-key',
        applicationID: 'test-app'
      }
    });
    tracker.tag = mockVideoElement;
    // Clear after construction so internal listener bindings from the real
    // VideoTracker base class don't bleed into individual test assertions
    jest.clearAllMocks();
  });

  describe('Tracker Metadata', () => {
    it('should return tracker name as hls', () => {
      expect(tracker.getTrackerName()).toBe('hls');
    });

    it('should return player name as HLS-JS', () => {
      expect(tracker.getPlayerName()).toBe('HLS-JS');
    });

    it('should return tracker version from package.json', () => {
      expect(tracker.getTrackerVersion()).toBe(version);
    });

    it('should return player version from Hls', () => {
      expect(tracker.getPlayerVersion()).toBe(Hls.version);
    });

    it('should return instrumentation name as HLS-JS', () => {
      expect(tracker.getInstrumentationName()).toBe('HLS-JS');
    });

    it('should return instrumentation provider as New Relic', () => {
      expect(tracker.getInstrumentationProvider()).toBe('New Relic');
    });

    it('should return instrumentation version from player', () => {
      expect(tracker.getInstrumentationVersion()).toBe(Hls.version);
    });
  });

  describe('Playback Information', () => {
    it('should return playhead in milliseconds', () => {
      mockVideoElement.currentTime = 10;
      expect(tracker.getPlayhead()).toBe(10000);
    });

    it('should return duration in milliseconds', () => {
      mockVideoElement.duration = 100;
      expect(tracker.getDuration()).toBe(100000);
    });

    it('should return current source', () => {
      mockVideoElement.currentSrc = 'https://example.com/stream.m3u8';
      expect(tracker.getSrc()).toBe('https://example.com/stream.m3u8');
    });

    it('should return muted status', () => {
      mockVideoElement.muted = true;
      expect(tracker.isMuted()).toBe(true);
    });

    it('should return playrate', () => {
      mockHlsInstance.playbackRate = 1.5;
      expect(tracker.getPlayrate()).toBe(1.5);
    });

    it('should return autoplay status', () => {
      mockHlsInstance.autoplay = true;
      expect(tracker.isAutoplayed()).toBe(true);
    });

    it('should return preload status', () => {
      mockHlsInstance.preload = 'metadata';
      expect(tracker.getPreload()).toBe('metadata');
    });
  });

  describe('Quality/Bitrate Information', () => {
    it('should return current video quality', () => {
      const quality = tracker.getCurrentVideoQuality();
      expect(quality).toEqual({
        bitrate: 258157,
        width: 426,
        height: 180,
        levelIndex: 0
      });
    });

    it('should return rendition height', () => {
      expect(tracker.getRenditionHeight()).toBe(180);
    });

    it('should return rendition width', () => {
      expect(tracker.getRenditionWidth()).toBe(426);
    });

    it('should return bitrate', () => {
      expect(tracker.getBitrate()).toBe(258157);
    });

    it('should return null for bitrate when no player available', () => {
      tracker.player = null;
      expect(tracker.getBitrate()).toBeNull();
    });

    it('should return null for quality when no levels available', () => {
      mockHlsInstance.currentLevel = -1;
      expect(tracker.getCurrentVideoQuality()).toBeNull();
    });

    it('should handle invalid level index', () => {
      mockHlsInstance.currentLevel = 999;
      expect(tracker.getCurrentVideoQuality()).toBeNull();
    });

    it('should return rendition name from current level', () => {
      expect(tracker.getRenditionName()).toBe('180');
    });

    it('should return null for rendition name when level has no name', () => {
      mockHlsInstance.levels[0] = { bitrate: 258157, width: 426, height: 180 };
      expect(tracker.getRenditionName()).toBeNull();
    });

    it('should return null for rendition name when player throws', () => {
      Object.defineProperty(tracker, 'player', {
        get() { throw new Error('player error'); },
        configurable: true,
      });
      expect(tracker.getRenditionName()).toBeNull();
      Object.defineProperty(tracker, 'player', {
        value: mockHlsInstance,
        configurable: true,
        writable: true,
      });
    });

    it('should return max bitrate across all levels', () => {
      expect(tracker.getManifestBitrate()).toBe(987654);
    });

    it('should return null for manifest bitrate when levels is empty', () => {
      mockHlsInstance.levels = [];
      expect(tracker.getManifestBitrate()).toBeNull();
    });

    it('should return null for manifest bitrate when player is null', () => {
      tracker.player = null;
      expect(tracker.getManifestBitrate()).toBeNull();
    });

    it('should return null for segment download bitrate before any fragment loads', () => {
      expect(tracker.getSegmentDownloadBitrate()).toBeNull();
    });

    it('should return cached segment bitrate after fragment load', () => {
      tracker._lastFragBandwidth = 500000;
      expect(tracker.getSegmentDownloadBitrate()).toBe(500000);
    });

    it('should return network download bitrate from bandwidthEstimate', () => {
      mockHlsInstance.bandwidthEstimate = 1234567;
      expect(tracker.getNetworkDownloadBitrate()).toBe(1234567);
    });

    it('should return null for network download bitrate when estimate is zero', () => {
      mockHlsInstance.bandwidthEstimate = 0;
      expect(tracker.getNetworkDownloadBitrate()).toBeNull();
    });

    it('should return null for network download bitrate when player is null', () => {
      tracker.player = null;
      expect(tracker.getNetworkDownloadBitrate()).toBeNull();
    });
  });

  describe('setPlayer Method', () => {
    it('should have setPlayer method', () => {
      expect(typeof tracker.setPlayer).toBe('function');
    });
  });

  describe('Event Listeners Registration', () => {
    it('should register HLS event listeners', () => {
      tracker.registerListeners();
      expect(mockHlsInstance.on).toHaveBeenCalledWith(
        Hls.Events.LEVEL_SWITCHED,
        expect.any(Function)
      );
      expect(mockHlsInstance.on).toHaveBeenCalledWith(
        Hls.Events.FRAG_LOADED,
        expect.any(Function)
      );
      expect(mockHlsInstance.on).toHaveBeenCalledWith(
        Hls.Events.BUFFER_APPENDED,
        expect.any(Function)
      );
      expect(mockHlsInstance.on).toHaveBeenCalledWith(
        Hls.Events.ERROR,
        expect.any(Function)
      );
    });

    it('should register HTML5 video event listeners', () => {
      tracker.registerListeners();
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith(
        'play',
        expect.any(Function)
      );
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith(
        'pause',
        expect.any(Function)
      );
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith(
        'seeking',
        expect.any(Function)
      );
      expect(mockVideoElement.addEventListener).toHaveBeenCalledWith(
        'ended',
        expect.any(Function)
      );
    });

    it('should not register listeners if player is not available', () => {
      tracker.player = null;
      tracker.registerListeners();
      expect(mockHlsInstance.on).not.toHaveBeenCalled();
    });
  });

  describe('Event Listeners Unregistration', () => {
    beforeEach(() => {
      tracker.registerListeners();
      jest.clearAllMocks();
    });

    it('should unregister HLS event listeners', () => {
      tracker.unregisterListeners();
      expect(mockHlsInstance.off).toHaveBeenCalledWith(
        Hls.Events.LEVEL_SWITCHED,
        expect.any(Function)
      );
      expect(mockHlsInstance.off).toHaveBeenCalledWith(
        Hls.Events.FRAG_LOADED,
        expect.any(Function)
      );
    });

    it('should unregister HTML5 video event listeners', () => {
      tracker.unregisterListeners();
      expect(mockVideoElement.removeEventListener).toHaveBeenCalledWith(
        'play',
        expect.any(Function)
      );
      expect(mockVideoElement.removeEventListener).toHaveBeenCalledWith(
        'pause',
        expect.any(Function)
      );
    });

    it('should not attempt to unregister if player is unavailable', () => {
      tracker.player = null;
      tracker.unregisterListeners();
      expect(mockHlsInstance.off).not.toHaveBeenCalled();
    });
  });

  describe('Event Handlers', () => {
    it('should pass oldBitrate null and newBitrate on first quality change', () => {
      tracker.sendRenditionChanged = jest.fn();
      tracker.onQualityChange(null, { level: 1 });
      expect(tracker.sendRenditionChanged).toHaveBeenCalledWith({
        oldBitrate: null,
        newBitrate: 512345,
      });
    });

    it('should pass oldBitrate and newBitrate on subsequent quality change', () => {
      tracker.sendRenditionChanged = jest.fn();
      tracker.onQualityChange(null, { level: 1 }); // first switch
      tracker.onQualityChange(null, { level: 2 }); // second switch
      expect(tracker.sendRenditionChanged).toHaveBeenLastCalledWith({
        oldBitrate: 512345,
        newBitrate: 987654,
      });
    });

    it('should not call sendRenditionChanged when level data is missing', () => {
      tracker.sendRenditionChanged = jest.fn();
      tracker.onQualityChange(null, {});
      expect(tracker.sendRenditionChanged).not.toHaveBeenCalled();
    });

    it('should handle download/fragment loaded event', () => {
      tracker.sendDownload = jest.fn();
      tracker.onDownload({ type: 'frag_loaded' });
      expect(tracker.sendDownload).toHaveBeenCalled();
    });

    it('should handle buffer appended event', () => {
      tracker.sendBufferEnd = jest.fn();
      tracker.onBufferAppended();
      expect(tracker.sendBufferEnd).toHaveBeenCalled();
    });

    it('should handle play event', () => {
      tracker.sendRequest = jest.fn();
      tracker.onPlay();
      expect(tracker.sendRequest).toHaveBeenCalled();
    });

    it('should handle playing event', () => {
      tracker.sendBufferEnd = jest.fn();
      tracker.sendResume = jest.fn();
      tracker.onPlaying();
      expect(tracker.sendResume).toHaveBeenCalled();
      expect(tracker.sendBufferEnd).toHaveBeenCalled();
    });

    it('should fire sendStart from timeupdate once playhead passes 0.1s', () => {
      tracker.sendStart = jest.fn();
      tracker.tag = { currentTime: 0 };
      tracker.onTimeupdate();
      expect(tracker.sendStart).not.toHaveBeenCalled();
      tracker.tag = { currentTime: 0.2 };
      tracker.onTimeupdate();
      expect(tracker.sendStart).toHaveBeenCalled();
    });

    it('should handle pause event', () => {
      tracker.sendPause = jest.fn();
      tracker.onPause();
      expect(tracker.sendPause).toHaveBeenCalled();
    });

    it('should handle seeking event', () => {
      tracker.sendSeekStart = jest.fn();
      tracker.onSeeking();
      expect(tracker.sendSeekStart).toHaveBeenCalled();
    });

    it('should handle seeked event', () => {
      tracker.sendSeekEnd = jest.fn();
      tracker.onSeeked();
      expect(tracker.sendSeekEnd).toHaveBeenCalled();
    });

    it('should handle ended event', () => {
      tracker.sendEnd = jest.fn();
      tracker.onEnded();
      expect(tracker.sendEnd).toHaveBeenCalled();
    });

    it('should handle canplaythrough event', () => {
      tracker.sendBufferEnd = jest.fn();
      tracker.onCanPlayThrough();
      expect(tracker.sendBufferEnd).toHaveBeenCalled();
    });

    it('should fire sendPlayerReady on MANIFEST_PARSED', () => {
      tracker.sendPlayerReady = jest.fn();
      tracker.onManifestParsed();
      expect(tracker.sendPlayerReady).toHaveBeenCalled();
    });

    it('should handle HLS error event with code', () => {
      tracker.sendError = jest.fn();
      const errorData = { code: 404, fatal: false };
      tracker.onError('error', errorData);
      expect(tracker.sendError).toHaveBeenCalledWith({
        errorCode: 404,
        errorMessage: 'Recoverable error',
        data: errorData
      });
    });

    it('should handle fatal HLS error', () => {
      tracker.sendError = jest.fn();
      const errorData = { code: 500, fatal: true };
      tracker.onError('error', errorData);
      expect(tracker.sendError).toHaveBeenCalledWith({
        errorCode: 500,
        errorMessage: 'Fatal error',
        data: errorData
      });
    });

    it('should handle video element error event', () => {
      tracker.sendError = jest.fn();
      const error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
      mockHlsInstance.error = error;
      tracker.onVideoError({});
      expect(tracker.sendError).toHaveBeenCalled();
    });

    it('should send buffer start when player is stalled', () => {
      tracker.sendBufferStart = jest.fn();
      mockHlsInstance.networkState = 2;   // NETWORK_LOADING
      mockHlsInstance.readyState = 2;     // < HAVE_FUTURE_DATA (3)
      mockHlsInstance.NETWORK_LOADING = 2;
      mockHlsInstance.HAVE_FUTURE_DATA = 3;
      tracker.onWaiting();
      expect(tracker.sendBufferStart).toHaveBeenCalled();
    });

    it('should not send buffer start when player is not stalled', () => {
      tracker.sendBufferStart = jest.fn();
      mockHlsInstance.networkState = 1;   // not NETWORK_LOADING
      mockHlsInstance.readyState = 4;
      mockHlsInstance.NETWORK_LOADING = 2;
      mockHlsInstance.HAVE_FUTURE_DATA = 3;
      tracker.onWaiting();
      expect(tracker.sendBufferStart).not.toHaveBeenCalled();
    });

    it('should handle video element error when player.error is falsy', () => {
      tracker.sendError = jest.fn();
      mockHlsInstance.error = null;
      tracker.onVideoError({ type: 'error' });
      expect(tracker.sendError).toHaveBeenCalledWith({ error: { type: 'error' } });
    });

    it('should send end on DESTROYING event', () => {
      tracker.sendEnd = jest.fn();
      tracker.onDestroying();
      expect(tracker.sendEnd).toHaveBeenCalled();
    });

    it('should cache bandwidth on FRAG_LOADED with valid bwEstimate', () => {
      tracker.onFragLoaded('hlsFragLoaded', { stats: { bwEstimate: 2000000 } });
      expect(tracker.getSegmentDownloadBitrate()).toBe(2000000);
    });

    it('should not cache bandwidth on FRAG_LOADED when bwEstimate is zero', () => {
      tracker._lastFragBandwidth = 999;
      tracker.onFragLoaded('hlsFragLoaded', { stats: { bwEstimate: 0 } });
      expect(tracker.getSegmentDownloadBitrate()).toBe(999);
    });

    it('should not cache bandwidth on FRAG_LOADED when stats are missing', () => {
      tracker._lastFragBandwidth = 999;
      tracker.onFragLoaded('hlsFragLoaded', {});
      expect(tracker.getSegmentDownloadBitrate()).toBe(999);
    });
  });
});
