import nrvideo from '@newrelic/video-core';
import { version } from '../package.json';

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
    return this.getTrackerName();
  }

  getInstrumentationVersion() {
    return this.getTrackerVersion();
  }

  getPlayerVersion() {
    return this.player?.constructor?.version ?? null;
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
  
  getRenditionName() {
    try {
      const level = this.player?.levels?.[this.player.currentLevel];
      if (level?.name) return level.name;
    } catch (err) {}
    return null;
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

  getManifestBitrate() {
    const levels = this.player?.levels;
    if (levels && levels.length > 0) {
      const max = Math.max(...levels.map((l) => l.bitrate || 0));
      return max > 0 ? Math.round(max) : null;
    }
    return null;
  }

  getSegmentDownloadBitrate() {
    return this._lastFragBandwidth ?? null;
  }

  getNetworkDownloadBitrate() {
    const bw = this.player?.bandwidthEstimate;
    return bw && bw > 0 ? Math.round(bw) : null;
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

    const HlsEvents = this.player.constructor.Events;

    nrvideo.Log.debugCommonVideoEvents(this.player);

    // Hook HLS.js events - store bound methods for proper cleanup
    // Manifest and level events
    this._onQualityChange = this.onQualityChange.bind(this);
    this._onDownload = this.onDownload.bind(this);
    this._onFragLoaded = this.onFragLoaded.bind(this);
    this._onManifestParsed = this.onManifestParsed.bind(this);
    this._onBufferAppended = this.onBufferAppended.bind(this);
    this._onError = this.onError.bind(this);
    this._onDestroying = this.onDestroying.bind(this);

    this.player.on(HlsEvents.MANIFEST_LOADING, this._onDownload);
    this.player.on(HlsEvents.MANIFEST_PARSED, this._onManifestParsed);
    this.player.on(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    this.player.on(HlsEvents.FRAG_LOADED, this._onFragLoaded);
    this.player.on(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    this.player.on(HlsEvents.ERROR, this._onError);
    this.player.on(HlsEvents.DESTROYING, this._onDestroying);

    // Hook HTML5 video element events (for events HLS.js doesn't provide)
    // Bind methods to preserve 'this' context and store for cleanup
    this.onTagDownload = this.onTagDownload.bind(this);
    this.onPlay = this.onPlay.bind(this);
    this.onPlaying = this.onPlaying.bind(this);
    this.onPause = this.onPause.bind(this);
    this.onSeeking = this.onSeeking.bind(this);
    this.onSeeked = this.onSeeked.bind(this);
    this.onEnded = this.onEnded.bind(this);
    this.onWaiting = this.onWaiting.bind(this);
    this.onCanPlayThrough = this.onCanPlayThrough.bind(this);
    this.onTimeupdate = this.onTimeupdate.bind(this);
    this.onVideoError = this.onVideoError.bind(this);

    // Register HTML5 video event listeners
    // this.tag.addEventListener('loadeddata', this.onTagDownload);
    // this.tag.addEventListener('loadedmetadata', this.onTagDownload);
    this.tag.addEventListener('play', this.onPlay);
    this.tag.addEventListener('playing', this.onPlaying);
    this.tag.addEventListener('pause', this.onPause);
    this.tag.addEventListener('seeking', this.onSeeking);
    this.tag.addEventListener('seeked', this.onSeeked);
    this.tag.addEventListener('ended', this.onEnded);
    this.tag.addEventListener('waiting', this.onWaiting);
    this.tag.addEventListener('canplaythrough', this.onCanPlayThrough);
    this.tag.addEventListener('timeupdate', this.onTimeupdate);
    this.tag.addEventListener('error', this.onVideoError);
  }

  unregisterListeners() {
    if (!this.player || !this.tag) return;

    const HlsEvents = this.player.constructor.Events;

    // Unregister HLS.js events using stored bound methods
    if (this._onQualityChange) {
      this.player.off(HlsEvents.LEVEL_SWITCHED, this._onQualityChange);
    }
    if (this._onDownload) {
      this.player.off(HlsEvents.MANIFEST_LOADING, this._onDownload);
    }
    if (this._onFragLoaded) {
      this.player.off(HlsEvents.FRAG_LOADED, this._onFragLoaded);
    }
    if (this._onManifestParsed) {
      this.player.off(HlsEvents.MANIFEST_PARSED, this._onManifestParsed);
    }
    if (this._onBufferAppended) {
      this.player.off(HlsEvents.BUFFER_APPENDED, this._onBufferAppended);
    }
    if (this._onError) {
      this.player.off(HlsEvents.ERROR, this._onError);
    }
    if (this._onDestroying) {
      this.player.off(HlsEvents.DESTROYING, this._onDestroying);
    }

    // Unregister HTML5 video event listeners
    if (this.onTagDownload) {
      this.tag.removeEventListener('loadeddata', this.onTagDownload);
      this.tag.removeEventListener('loadedmetadata', this.onTagDownload);
    }
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
    if (this.onCanPlayThrough) {
      this.tag.removeEventListener('canplaythrough', this.onCanPlayThrough);
    }
    if (this.onTimeupdate) {
      this.tag.removeEventListener('timeupdate', this.onTimeupdate);
    }
    if (this.onVideoError) {
      this.tag.removeEventListener('error', this.onVideoError);
    }
  }

  onDownload(event, data) {
    this.sendDownload({ state: event });
  }

  onFragLoaded(event, data) {
    if (data?.stats?.bwEstimate > 0) {
      this._lastFragBandwidth = Math.round(data.stats.bwEstimate);
    }
  }

  onTagDownload(e) {
    this.sendDownload({ state: e.type });
  }

  onManifestParsed() {
    this.sendPlayerReady();
  }

  onPlay() {
    this.sendRequest();
  }

  onPlaying() {
    this.sendResume();
    this.sendBufferEnd();
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
    const errorCode = data?.code;
    const errorMessage = data?.message || data?.reason || data?.details ;
    if (errorCode || errorMessage) {
      this.sendError({ errorCode, errorMessage});
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

  onDestroying() {
    this.sendEnd();
  }

  onEnded() {
    this.sendEnd();
  }

  onTimeupdate() {
    if (this.getPlayhead() > 0.1) {
      this.sendStart();
    }
  }

  onWaiting() {
    if (
      this.tag.networkState === this.tag.NETWORK_LOADING &&
      this.tag.readyState < this.tag.HAVE_FUTURE_DATA
    ) {
      this.sendBufferStart();
    }
  }

  onQualityChange(event, data) {
    if (data?.level === undefined) return;

    const newLevel = this.player.levels[data.level];
    if (!newLevel) return;

    const newBitrate = newLevel.bitrate ?? null;
    const oldBitrate = this._previousLevelIndex != null
      ? (this.player.levels[this._previousLevelIndex]?.bitrate ?? null)
      : null;

    this._previousLevelIndex = data.level;
    this.sendRenditionChanged({ oldBitrate, newBitrate });
  }

  onBufferAppended(event, data) {
    this.sendBufferEnd();
  }

  onCanPlayThrough() {
    this.sendBufferEnd();
  }
}
