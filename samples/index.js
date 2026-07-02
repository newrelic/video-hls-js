const options = {
  info: {
    beacon: '',
    licenseKey: '',
    applicationID: '',
  },
};

// Initialize your player with new relic Tracker to send data




var video = document.getElementById('video');
var videoSrc = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
var hls = null;
var tracker = null;

if (Hls.isSupported()) {
  hls = new Hls();
  hls.loadSource(videoSrc);
  hls.attachMedia(video);
  // Create tracker after HLS is initialized and media is attached
  // Pass an object with both hls instance and media element
  tracker = new HLSTracker(hls, options);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Native HLS support (Safari)
  video.src = videoSrc;
}
