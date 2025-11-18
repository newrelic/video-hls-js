[![Experimental Project header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/oss-category/#experimental)

# New Relic HLS Tracker Agent

The New Relic HLS Tracker enhances your media applications by tracking video events, playback errors, and other activities, providing comprehensive insights into performance and user interactions.

- The HLS tracker is available as a ready-to-use JavaScript snippet for easy copy-paste integration.
- New Relic HLS tracker auto-detects events emitted by HLS Player.
- Ensure that the **Browser agent** is successfully instrumented before deploying the media tracker.
- For questions and feedback on this package, please visit the [Explorer's Hub](https://discuss.newrelic.com), New Relic's community support forum.
- Looking to contribute to the Player Name agent code base? See [DEVELOPING.md](./DEVELOPING.md) for instructions on building and testing the browser agent library, and Contributors.

## Adding The HLS Tracker To Your Project With Placing Snippet Code From Onboarding

To integrate New Relic Tracker Agent into your web application effectively, Get HLS Tracker Sdk from Onboarding and Place it on top JS File

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@canary"></script>
  <script src="../dist/umd/newrelic-video-hls.min.js"></script>
</head>
<body>  
<video id="video" controls height="315" width="500"></video>
</body>
</html>
```

## Instantiating the HLS Tracker

```javascript
//Add import statement
import HLSTracker from '@newrelic/video-hls';

// Get Application info from onboarding steps of new relic
const options = {
  info: {
    beacon: '',
    licenseKey: '',
    applicationID: '',
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

```

## Data Model

To understand which actions and attributes are captured and emitted by the HLS Player under different event types, see [DataModel.md](./DATAMODEL.md).

## Support

New Relic hosts and moderates an online forum where customers can interact with New Relic employees as well as other customers to get help and share best practices. Like all official New Relic open source projects, there's a related Community topic in the New Relic [Explorer's Hub](https://discuss.newrelic.com).

We encourage you to bring your experiences and questions to the [Explorer's Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.

## Contributing

We encourage your contributions to improve New Relic HLS Tracker! Keep in mind when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project. If you have any questions, or to execute our corporate CLA, required if your contribution is on behalf of a company, please drop us an email at opensource@newrelic.com.

**A note about vulnerabilities**

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through [our bug bounty program](https://docs.newrelic.com/docs/security/security-privacy/information-security/report-security-vulnerabilities/).

## Pricing

Important: Ingesting video telemetry data via this video agent requires a subscription to an Advanced Compute. Contact your New Relic account representative for more details on pricing and entitlement.

## License

New Relic HLS Tracker is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.
