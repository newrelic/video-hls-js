import HLSTracker, { DaiTracker } from '../index';
import Hls from 'hls.js';

const mockTag = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  currentTime: 0,
  duration: 0,
  currentSrc: '',
  muted: false,
};

const makeMockPlayer = () => ({
  on: jest.fn(),
  off: jest.fn(),
  currentLevel: 0,
  levels: [],
  media: mockTag,
  constructor: Hls,
});

describe('HLSTracker Index Export', () => {
  it('should export HLSTracker as default export', () => {
    expect(HLSTracker).toBeDefined();
  });

  it('should be a constructor function', () => {
    expect(typeof HLSTracker).toBe('function');
  });

  it('should be able to instantiate HLSTracker', () => {
    const options = {
      info: {
        beacon: 'https://example.com',
        licenseKey: 'test-key',
        applicationID: 'test-app'
      }
    };

    const tracker = new HLSTracker(makeMockPlayer(), options);
    expect(tracker).toBeInstanceOf(HLSTracker);
  });

  it('should have expected methods', () => {
    const tracker = new HLSTracker(makeMockPlayer(), {});

    // Core methods
    expect(typeof tracker.getTrackerName).toBe('function');
    expect(typeof tracker.getPlayerName).toBe('function');
    expect(typeof tracker.getTrackerVersion).toBe('function');
    expect(typeof tracker.getPlayerVersion).toBe('function');

    // Playback information methods
    expect(typeof tracker.getPlayhead).toBe('function');
    expect(typeof tracker.getDuration).toBe('function');
    expect(typeof tracker.getSrc).toBe('function');
    expect(typeof tracker.isMuted).toBe('function');
    expect(typeof tracker.getPlayrate).toBe('function');

    // Quality methods
    expect(typeof tracker.getBitrate).toBe('function');
    expect(typeof tracker.getRenditionHeight).toBe('function');
    expect(typeof tracker.getRenditionWidth).toBe('function');

    // Event methods
    expect(typeof tracker.registerListeners).toBe('function');
    expect(typeof tracker.unregisterListeners).toBe('function');
  });
});

describe('DaiTracker Index Export', () => {
  it('should export DaiTracker as a named export', () => {
    expect(DaiTracker).toBeDefined();
    expect(typeof DaiTracker).toBe('function');
  });

  // The UMD bundle is built with libraryExport: 'default', so window.HLSTracker
  // is the class itself and named exports are unreachable from a script tag.
  // Script-tag consumers reach DAI via HLSTracker.DaiTracker.
  it('should expose DaiTracker as a static on HLSTracker for UMD consumers', () => {
    expect(HLSTracker.DaiTracker).toBe(DaiTracker);
  });
});
