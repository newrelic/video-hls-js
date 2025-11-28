import nrvideo from '@newrelic/video-core';
import { version } from '../package.json';
import Hls from 'hls.js';

// Cache HLS events for performance
const HlsEvents = Hls.Events;

export default class HLSTracker extends nrvideo.VideoTracker {
  constructor(player, options) {
    super(player, options);
    nrvideo.Core.addTracker(this, options);
    this.options = options;

  }
  setPlayer(player, tag) {
    if (!tag && player.media) tag = player.media;
    nrvideo.VideoTracker.prototype.setPlayer.call(this, player, tag);
  }

  getTrackerName() {
    return 'hls';
  }

  getPlayerName() {
    return 'HLS-JS';
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
    return Hls.version;
  }

  getTrackerVersion() {
    return version;
  }

  getPlayhead() {
    return this.tag.currentTime * 1000;
  }

  getDuration() {
    return this.tag.duration * 1000;
  }

  getSrc() {
    return this.tag.currentSrc;
  }

  isMuted() {
    return this.tag.muted;
  }

  getCurrentVideoQuality() {
    if (!this.player) return null
    
    const levelIndex = this.player.currentLevel;
    if (levelIndex < 0 || !this.player.levels) return null; // auto or unknown yet
  
    const level = this.player.levels[levelIndex];
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
    if (!this.player) {
      return;
    }

    nrvideo.Log.debugCommonVideoEvents(this.player);

    // Hook HLS.js events - store bound methods for proper cleanup
    // Manifest and level events
    this._onQualityChange = this.onQualityChange.bind(this);
    this._onDownload = this.onDownload.bind(this);
    this._onBufferAppended = this.onBufferAppended.bind(this);
    this._onError = this.onError.bind(this);
    
    this.player.on(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    this.player.on(HlsEvents.FRAG_LOADED, this._onDownload);
    this.player.on(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    this.player.on(HlsEvents.ERROR, this._onError);
    
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
    this.tag.addEventListener('play', this.onPlay);
    this.tag.addEventListener('playing', this.onPlaying);
    this.tag.addEventListener('pause', this.onPause);
    this.tag.addEventListener('seeking', this.onSeeking);
    this.tag.addEventListener('seeked', this.onSeeked);
    this.tag.addEventListener('ended', this.onEnded);
    this.tag.addEventListener('waiting', this.onWaiting);
    this.tag.addEventListener('canplay', this.onCanPlay);
    this.tag.addEventListener('error', this.onVideoError);
  }

  unregisterListeners() {
    if (!this.player || !this.tag) return;

    // Unregister HLS.js events using stored bound methods
    if (this._onQualityChange) {
      this.player.off(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    }
    if (this._onDownload) {
      this.player.off(HlsEvents.FRAG_LOADED, this._onDownload);
    }
    if (this._onBufferAppended) {
      this.player.off(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    }
    if (this._onError) {
      this.player.off(HlsEvents.ERROR, this._onError);
    }

    // Unregister HTML5 video event listeners
    if (this.onPlay) {
      this.tag.removeEventListener('play', this.onPlay);
    }
    if (this.onPlaying) {
      this.tag.removeEventListener('playing', this.onPlaying);
    }
    if (this.onPause) {
      this.tag.removeEventListener('pause', this.onPause);
    }
    if (this.onSeeking) {
      this.tag.removeEventListener('seeking', this.onSeeking);
    }
    if (this.onSeeked) {
      this.tag.removeEventListener('seeked', this.onSeeked);
    }
    if (this.onEnded) {
      this.tag.removeEventListener('ended', this.onEnded);
    }
    if (this.onWaiting) {
      this.tag.removeEventListener('waiting', this.onWaiting);
    }
    if (this.onCanPlay) {
      this.tag.removeEventListener('canplay', this.onCanPlay);
    }
    if (this.onVideoError) {
      this.tag.removeEventListener('error', this.onVideoError);
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
    const level = data?.level !== undefined ? this.player.levels[data.level] : null;
    if (level) {
      this.sendRenditionChanged();
    }
  }

  onBufferAppended(event, data) {
    this.sendBufferEnd();
  }

  onCanPlay() {
    this.sendPlayerReady();
  }
}
