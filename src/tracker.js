import nrvideo from '@newrelic/video-core';
import { version } from '../package.json';
import Hls from 'hls.js';

// Cache HLS events for performance
const HlsEvents = Hls.Events;

export default class HLSTracker extends nrvideo.VideoTracker {
  constructor(player, options) {
    super(player.media, options);
    
    // Now set this.hls immediately after super() so it's available
    this.hls = player;
    this.registerListeners();
    
    nrvideo.Core.addTracker(this, options);
    this.options = options;
  }
  getTrackerName() {
    return 'hls';
  }

  getPlayerName() {
    return 'HLS';
  }

  getInstrumentationProvider() {
    return 'New Relic';
  }

  getInstrumentationName() {
    return this.getPlayerName();
  }

  getInstrumentationVersion() {
    return this.getPlayerVersion();
  }

  getPlayerVersion() {
    return version;
  }

  getPlayhead() {
    return this.player.currentTime * 1000;
  }

  getDuration() {
    return this.player.duration * 1000;
  }

  getSrc() {
    return this.player.currentSrc;
  }

  isMuted() {
    return this.player.muted;
  }

  getCurrentVideoQuality() {
    if (!this.hls) return null;
    
    const levelIndex = this.hls.currentLevel;
    if (levelIndex < 0 || !this.hls.levels) return null; // auto or unknown yet
  
    const level = this.hls.levels[levelIndex];
    if (!level) return null;
    
    return {
      bitrate: level.bitrate,
      width: level.width,
      height: level.height,
      levelIndex: levelIndex
    };
  }
  
  getRenditionHeight() {
    const quality = this.getCurrentVideoQuality();
    return quality?.height ?? null;
  }

  getRenditionWidth() {
    const quality = this.getCurrentVideoQuality();
    return quality?.width ?? null;
  }

  getBitrate() {
    const quality = this.getCurrentVideoQuality();
    return quality?.bitrate ?? null;
  }

  getPlayrate() {
    return this.player.playbackRate;
  }

  isAutoplayed() {
    return this.player.autoplay;
  }

  getPreload() {
    return this.player.preload;
  }

  registerListeners() {
    // Guard: Ensure HLS instance exists before registering listeners
    if (!this.hls) {
      return;
    }

    nrvideo.Log.debugCommonVideoEvents(this.player);

    // Hook HLS.js events - store bound methods for proper cleanup
    // Manifest and level events
    this._onManifestLoaded = this.onManifestLoaded.bind(this);
    this._onQualityChange = this.onQualityChange.bind(this);
    this._onDownload = this.onDownload.bind(this);
    this._onBufferAppended = this.onBufferAppended.bind(this);
    this._onError = this.onError.bind(this);
    
    this.hls.on(HlsEvents.MANIFEST_LOADED, this._onManifestLoaded);
    this.hls.on(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    this.hls.on(HlsEvents.FRAG_LOADED, this._onDownload);
    this.hls.on(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    this.hls.on(HlsEvents.ERROR, this._onError);
    
    // Hook HTML5 video element events (for events HLS.js doesn't provide)
    // Bind methods to preserve 'this' context and store for cleanup
    this.onPlay = this.onPlay.bind(this);
    this.onPlaying = this.onPlaying.bind(this);
    this.onPause = this.onPause.bind(this);
    this.onSeeking = this.onSeeking.bind(this);
    this.onSeeked = this.onSeeked.bind(this);
    this.onEnded = this.onEnded.bind(this);
    this.onWaiting = this.onWaiting.bind(this);
    this.onCanPlay = this.onCanPlay.bind(this);
    this.onVideoError = this.onVideoError.bind(this);

    // Register HTML5 video event listeners
    this.player.addEventListener('play', this.onPlay);
    this.player.addEventListener('playing', this.onPlaying);
    this.player.addEventListener('pause', this.onPause);
    this.player.addEventListener('seeking', this.onSeeking);
    this.player.addEventListener('seeked', this.onSeeked);
    this.player.addEventListener('ended', this.onEnded);
    this.player.addEventListener('waiting', this.onWaiting);
    this.player.addEventListener('canplay', this.onCanPlay);
    this.player.addEventListener('error', this.onVideoError);
  }

  unregisterListeners() {
    if (!this.hls || !this.player) return;

    // Unregister HLS.js events using stored bound methods
    if (this._onManifestLoaded) {
      this.hls.off(HlsEvents.MANIFEST_LOADED, this._onManifestLoaded);
    }
    if (this._onQualityChange) {
      this.hls.off(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    }
    if (this._onDownload) {
      this.hls.off(HlsEvents.FRAG_LOADED, this._onDownload);
    }
    if (this._onBufferAppended) {
      this.hls.off(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    }
    if (this._onError) {
      this.hls.off(HlsEvents.ERROR, this._onError);
    }

    // Unregister HTML5 video event listeners
    if (this.onPlay) {
      this.player.removeEventListener('play', this.onPlay);
    }
    if (this.onPlaying) {
      this.player.removeEventListener('playing', this.onPlaying);
    }
    if (this.onPause) {
      this.player.removeEventListener('pause', this.onPause);
    }
    if (this.onSeeking) {
      this.player.removeEventListener('seeking', this.onSeeking);
    }
    if (this.onSeeked) {
      this.player.removeEventListener('seeked', this.onSeeked);
    }
    if (this.onEnded) {
      this.player.removeEventListener('ended', this.onEnded);
    }
    if (this.onWaiting) {
      this.player.removeEventListener('waiting', this.onWaiting);
    }
    if (this.onCanPlay) {
      this.player.removeEventListener('canplay', this.onCanPlay);
    }
    if (this.onVideoError) {
      this.player.removeEventListener('error', this.onVideoError);
    }
  }

  onDownload(event, data) {
    this.sendDownload({ state: event });
  }

  onPlay() {
    this.sendRequest();
  }

  onPlaying() {
    this.sendBufferEnd();
    this.sendResume();
    this.sendStart();
  }

  onPause() {
    this.sendPause();
  }

  onSeeking() {
    this.sendSeekStart();
  }

  onSeeked() {
    this.sendSeekEnd();
  }

  onError(event, data) {
    // HLS.js error event provides data object with error details
    const errorCode = data?.details || data?.type || data?.code;
    const errorMessage = data?.message || data?.reason || data?.fatal ? 'Fatal error' : 'Recoverable error';
    if (errorCode || errorMessage) {
      this.sendError({ errorCode, errorMessage, data });
    } else {
      this.sendError({ error: data || event });
    }
  }

  onVideoError(e) {
    // HTML5 video element error
    const error = this.player.error;
    if (error) {
      const errorCode = error.code;
      const errorMessage = error.message || `Media error ${errorCode}`;
      this.sendError({ errorCode, errorMessage });
    } else {
      this.sendError({ error: e });
    }
  }

  onEnded() {
    this.sendEnd();
  }

  onWaiting() {
    if (
      this.player.networkState === this.player.NETWORK_LOADING &&
      this.player.readyState < this.player.HAVE_FUTURE_DATA
    ) {
      this.sendBufferStart();
    }
  }

  onQualityChange(event, data) {
    const level = data?.level !== undefined ? this.hls.levels[data.level] : null;
    if (level) {
      this.sendRenditionChanged();
    }
  }

  // HLS.js specific event handlers
  onManifestLoaded(event, data) {
    // Manifest loaded - getCurrentVideoQuality() will read from this.hls.levels[this.hls.currentLevel]
  }

  onBufferAppended(event, data) {
    this.sendBufferEnd();
  }

  onCanPlay() {
    this.sendPlayerReady();
  }
}
