const options = {
  info: {
    beacon: 'bam.nr-data.net',
    licenseKey: 'NRBR-01f969533907bc8f28f',
    applicationID: '594620663',
  },
};

var video = document.getElementById('video');
var videoSrc = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
var hls = null;
var tracker = null;

if (Hls.isSupported()) {
  console.log('Hls.isSupported');
  hls = new Hls();
  hls.loadSource(videoSrc);
  hls.attachMedia(video);
  console.log('video', hls.media);
  // Create tracker after HLS is initialized and media is attached
  // Pass an object with both hls instance and media element
  console.log('hls', hls);
  tracker = new HLSTracker(hls, options);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Native HLS support (Safari)
  video.src = videoSrc;
}
