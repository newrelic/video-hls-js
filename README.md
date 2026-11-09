[![Community Project header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Community_Project.png)](https://opensource.newrelic.com/oss-category/#community-project)

# New Relic HLS.js Tracker

[![npm version](https://badge.fury.io/js/%40newrelic%2Fvideo-hls.svg)](https://badge.fury.io/js/%40newrelic%2Fvideo-hls)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The New Relic HLS.js Tracker provides comprehensive video analytics for applications using HLS.js. Track video events, monitor playback quality, identify errors, and gain deep insights into user engagement and streaming performance for HLS content.

## Features

- 🎯 **Automatic Event Detection** - Captures HLS.js player events automatically without manual instrumentation
- 📊 **Comprehensive Bitrate Tracking** - Four distinct bitrate metrics for complete quality analysis
- 🔄 **Adaptive Bitrate Monitoring** - Tracks rendition changes with old and new bitrate values
- 📈 **QoE Metrics** - Quality of Experience tracking for startup time, buffering, and playback quality
- 🎨 **Event Segregation** - Organized event types: `VideoAction`, `VideoAdAction`, `VideoErrorAction`, `VideoCustomAction`
- 📺 **Google DAI Ads** - Server-side ad insertion tracking: ad breaks, quartiles, clicks and ad errors
- 🚀 **Easy Integration** - NPM package or direct script include
- ⚡ **Real-Time Performance** - Network throughput and per-segment download bitrate monitoring
- 🎬 **HLS Specific** - Optimized for adaptive streaming using Media Source Extensions (MSE)

## Table of Contents

- [Upgrade notes](#upgrade-notes)
- [Installation](#installation)
  - [Option 1: NPM/Yarn](#option-1-install-via-npmyarn)
  - [Option 2: Direct Script Include](#option-2-direct-script-include-without-npm)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
  - [Google DAI Ad Tracking](#google-dai-ad-tracking)
- [Best Practices](#best-practices)
- [Configuration Options](#configuration-options)
- [API Reference](#api-reference)
- [Bitrate Metrics](#bitrate-metrics)
- [Data Model](#data-model)
- [Support](#support)
- [Contribute](#contribute)
- [License](#license)

## Upgrade notes

> ⚠️ **Non-fatal hls.js errors are no longer reported.** This applies to **every**
> consumer of this release, whether or not you track ads, and it changes your
> error data.
>
> hls.js raises recoverable conditions it then handles itself on the same
> `Hls.Events.ERROR` event as genuine failures, distinguished only by `fatal`.
> Reporting them charged `numberOfErrors` and `hadPlaybackError` — and, for
> anything arriving before `CONTENT_START`, `hadStartupError` — to sessions that
> played perfectly well: one live capture reported `hadStartupError` on a 245ms
> startup, and an ordinary seek produced two `aborted` errors.
>
> The tracker now drops any error whose `data.fatal` is explicitly `false`. An
> error that does not state whether it is fatal is still reported.
>
> **What this means for you when you upgrade:**
>
> - `numberOfErrors` and the error-event rate for the same traffic will drop, so
>   alert conditions and dashboards built on `VideoErrorAction` counts,
>   `numberOfErrors` or `hadPlaybackError` need their thresholds revisited.
> - Non-fatal errors that carried useful signal are no longer sent. The clearest
>   case is `fragLoadError` retries: hls.js reports those non-fatally while it
>   retries the segment, and they were a usable CDN health signal. If you
>   depended on them, raise an issue — a configurable severity threshold is the
>   natural follow-up.
> - Fatal errors are unaffected, as is `hadStartupError` for real startup
>   failures.

## Installation

### Option 1: Install via NPM/Yarn

Install the package using your preferred package manager:

**NPM:**
```bash
npm install @newrelic/video-hls
```

**Yarn:**
```bash
yarn add @newrelic/video-hls
```

> **Note:** HLS.js is a peer dependency. Make sure it is installed separately:
> ```bash
> npm install hls.js
> ```

### Option 2: Direct Script Include (Without NPM)

For quick integration without a build system, include the tracker directly in your HTML:

```html
<!DOCTYPE html>
<html>
  <head>
    <!-- HLS.js Player -->
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

    <!-- New Relic HLS.js Tracker -->
    <script src="path/to/newrelic-video-hls.min.js"></script>
  </head>
  <body>
    <video id="myVideo" controls width="640" height="480"></video>

    <script>
      var video = document.getElementById('myVideo');
      var videoSrc = 'https://your-hls-stream.m3u8';

      // Configure New Relic tracker with info from one.newrelic.com
      var options = {
        info: {
          licenseKey: 'YOUR_LICENSE_KEY',
          beacon: 'YOUR_BEACON_URL',
          applicationID: 'YOUR_APP_ID'
        }
      };

      if (Hls.isSupported()) {
        var hls = new Hls();
        hls.loadSource(videoSrc);
        hls.attachMedia(video);

        // Initialize tracker after attaching media
        var tracker = new HLSTracker(hls, options);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = videoSrc;
      }
    </script>
  </body>
</html>
```

**Setup Steps:**

1. **Get Configuration** - Visit [one.newrelic.com](https://one.newrelic.com) and follow the Streaming Video & Ads onboarding flow to get your `licenseKey`, `beacon`, `applicationID`, and integration code snippet.
2. **Integrate** - Include the script in your HTML and initialize with your configuration.

## Prerequisites

Before using the tracker, ensure you have:

- **New Relic Account** - Active New Relic account with valid application credentials (`beacon`, `applicationID`, `licenseKey`)
- **HLS.js** - Version 1.x integrated in your application (peer dependency)

## Usage

### Getting Your Configuration

Before initializing the tracker, obtain your New Relic configuration:

1. Log in to [one.newrelic.com](https://one.newrelic.com)
2. Navigate to the video agent onboarding flow
3. Copy your credentials: `licenseKey`, `beacon`, and `applicationID`

### Browser Player Setup

Import from the `/browser` subpath — this build includes only the browser agent pipeline and excludes all connected-device code, keeping the bundle lean.

```javascript
import { HLSTracker } from '@newrelic/video-hls/browser';

const hls = new Hls();
hls.loadSource(videoSrc);
hls.attachMedia(video);

// Initialize tracker after attaching media, using the credentials from the previous step
const tracker = new HLSTracker(hls, {
  info: {
    licenseKey: 'YOUR_LICENSE_KEY',
    beacon: 'YOUR_BEACON_URL',
    applicationID: 'YOUR_APP_ID'
  }
});
```

### Advanced Configuration

```javascript
const options = {
  info: {
    licenseKey: 'YOUR_LICENSE_KEY',
    beacon: 'YOUR_BEACON_URL',
    applicationID: 'YOUR_APP_ID'
  },
  customData: {
    contentTitle: 'My Video Title',
    customPlayerName: 'MyCustomPlayer',
    customAttribute: 'customValue'
  }
};

const tracker = new HLSTracker(hls, options);
```

### Vega Setup (Fire TV)

For deployments targeting Amazon Vega or Fire TV (Kepler runtime), import from the `/vega` subpath and use `VegaTracker`. The `info` object uses `applicationToken` and `endpoint` specific to the Vega pipeline, plus an optional `deviceInfo` block carrying runtime device identity:

**Obtain your application token:**

1. Log in to [one.newrelic.com](https://one.newrelic.com)
2. Navigate to the video agent onboarding flow
3. Copy your `applicationToken` and your `accountId`

```javascript
import { VegaTracker } from '@newrelic/video-hls/vega';
import {
  getDeviceId, getSystemVersion, getModel, getBrand,
  getBuildIdSync, getBuildNumber,
} from '@amazon-devices/react-native-device-info';

const deviceInfo = {
  uuid:               getDeviceId(),
  osVersion:          getSystemVersion(),
  deviceModel:        getModel(),
  deviceManufacturer: getBrand(),
  osBuild:            getBuildIdSync(),    // OS image build
  appBuild:           getBuildNumber(),    // app build number
  architecture:       'aarch64',
};

const tracker = useRef(null);

// player.current        = your HlsJsPlayer wrapper
// player.current.player = hls.js instance 

// Initialize VegaTracker inside onSurfaceViewCreated BEFORE calling play(),
// so the tracker's listeners are registered before the 'play' event fires.
const onSurfaceViewCreated = (surfaceHandle) => {
  videoPlayer.current?.setSurfaceHandle(surfaceHandle);

  tracker.current = new VegaTracker(player.current.player, {
    info: {
      accountId:        'YOUR_ACCOUNT_ID',
      applicationToken: 'YOUR_NRMA_TOKEN',   // begins "AA…-NRMA"
      endpoint:         'US',                 // 'US' | 'EU' | 'staging' | 'GOV' | 'JP'
      deviceInfo,                             // optional but recommended
    },
    config: { qoeIntervalFactor: 1 },
    customData: { contentTitle: 'Vega HLS Stream' },
  });
  tracker.current.setUserId('YOUR_USER_ID');

  videoPlayer.current?.play();
};

// Dispose the tracker when content ends to release event listeners.
const onEnded = () => {
  tracker.current?.dispose();
  tracker.current = null;
};
```

#### `info.deviceInfo` field reference

All sub-fields optional — missing values fall back to the defaults baked into the SDK. Extra fields are ignored.

| Field | Recommended source | Falls back to |
| --- | --- | --- |
| `uuid` | `getDeviceId()` | `"00000000-0000-0000-0000-000000000000"` |
| `osVersion` | `getSystemVersion()` | `"1.0"` |
| `deviceModel` | `getModel()` | `"VegaDevice"` |
| `deviceManufacturer` | `getBrand()` | `"Amazon"` |
| `osBuild` | `getBuildIdSync()` — OS image build | `"1"` |
| `appBuild` | `getBuildNumber()` — app build number | `"1"` |
| `architecture` | `'aarch64'` | `"aarch64"` |

### Google DAI Ad Tracking

For streams with Google IMA DAI (Dynamic Ad Insertion) ads stitched in server-side, `DaiTracker` reports ad breaks, individual ads, quartiles, clicks and ad errors as `VideoAdAction` events on the same New Relic view as your content.

**Prerequisite:** load the IMA DAI SDK before constructing the tracker — `DaiTracker` reads `google.ima.dai.api.*` off the global scope and is a no-op (with a warning) if the SDK is missing.

```html
<script src="https://imasdk.googleapis.com/js/sdkloader/ima3_dai.js"></script>
```

Because hls.js has no ads plugin layer, the wiring is explicit: your application creates the `StreamManager` (as it already must, to obtain the stitched manifest URL) and hands it to `DaiTracker`.

```javascript
import HLSTracker, { DaiTracker } from '@newrelic/video-hls';

const video = document.getElementById('video');
const hls = new Hls();

// Attach the media element BEFORE constructing the tracker — the tracker
// resolves its video tag from hls.media, which is null until attachMedia().
hls.attachMedia(video);
const tracker = new HLSTracker(hls, options);

const streamManager = new google.ima.dai.api.StreamManager(video);

const daiTracker = new DaiTracker(streamManager, {
  tag: video,
  contentTracker: tracker,
});
tracker.setAdsTracker(daiTracker);

// DAI hands back the stitched manifest; hls.js plays it as one continuous stream.
streamManager.addEventListener(
  google.ima.dai.api.StreamEvent.Type.LOADED,
  (e) => hls.loadSource(e.getStreamData().url)
);

const request = new google.ima.dai.api.VODStreamRequest();
request.contentSourceId = 'YOUR_CMS_ID';
request.videoId = 'YOUR_VIDEO_ID';
streamManager.requestStream(request);
```

**Live streams additionally require you to forward ID3 timed metadata.** Use a `LiveStreamRequest` with an `assetKey`, and hand the stream's in-band ID3 samples to the SDK. A live break is signalled inside the media segments rather than in the cue point list, so without this the SDK never learns a break started and **no ad events fire at all**:

```javascript
hls.on(Hls.Events.FRAG_PARSING_METADATA, (event, data) => {
  data?.samples?.forEach((sample) => {
    streamManager.processMetadata('ID3', sample.data, sample.pts);
  });
});
```

It is harmless to register for VOD, where cue points carry the breaks.

`setAdsTracker()` is what links the two: it marks `DaiTracker` as an ad tracker and funnels its events into the content tracker's session, so ads and content share one `viewId`.

**Constructor options**

| Option | Required | Purpose |
| --- | --- | --- |
| `tag` | Yes | The `<video>` element. Source of stream time, mute state and VOD/live detection. |
| `contentTracker` | No | Your `HLSTracker` instance. The stitched stream is decoded by the same hls.js instance, so quality and manifest data live on the content tracker: pass this and ad events carry `adBitrate`, `adRenditionHeight`, `adRenditionWidth`, `adRenditionName`, and `getStreamType()` can distinguish live from VOD. Omit it and those are `null` during ads. |

#### What changes in your data

Attaching a `DaiTracker` changes five things about your data. All of them only apply while an ads tracker is attached — behaviour without one is unchanged.

**Content events stand down during a break.** Content pause, resume, seek and buffering are suppressed while an ad is on screen, and `CONTENT_START` is held until the break ends, so a pre-roll is not reported as content playback. They resume automatically afterwards.

**A transition already in progress still completes.** If content was buffering or seeking when the break began, that buffer/seek is closed at the real resume moment rather than held open — otherwise the whole ad pod would be billed to content rebuffering.

**`contentPlayhead` and `contentDuration` are content time, not stream time.** A stitched stream's clock includes every ad played so far, so these are converted via the SDK's `contentTimeForStreamTime`. On a 794s stream carrying 60s of ads, `contentDuration` reports 734s.

**`adPlayhead` is measured from the start of the ad, not the stitched stream position.** The media element's clock keeps running through an ad under SSAI, so a mid-roll would otherwise report a playhead in the hundreds of seconds for a 10s creative. It comes from the SDK's own ad clock (`adProgressData.currentTime`), which is ad-relative and starts at 0. One consequence is worth knowing before you build a dashboard: `adPlayhead` tops out near **99.76%** of `adDuration` and never reaches it, so measure ad completion from `AD_END` or the third quartile rather than comparing the two. See [DATAMODEL.md](DATAMODEL.md).

**DAI stream errors are reported as content errors as well as ad errors.** A failed stream request means nothing plays, and New Relic derives startup-failure metrics from content errors only. If a break is open the error is reported on both. Error messages have query strings stripped from any embedded request URL, because those carry identifiers such as `ppid` and `cust_params`.

**Script-tag (UMD) consumers** reach the class as a static on the global, since the UMD bundle exposes only the default export:

```javascript
var daiTracker = new HLSTracker.DaiTracker(streamManager, {
  tag: video,
  contentTracker: tracker,
});
```

A complete runnable example is in [`samples/dai/index.html`](samples/dai/index.html).

#### Limitations

- **Live pre-rolls may report `CONTENT_START` a moment early.** The pre-roll guard relies on DAI cue points, which the SDK provides for VOD only. On a live stream the guard falls back to the SDK's ad-break events, and those arrive just after playback has already entered the ad.
- **Ad position on live streams is unverified.** `adPosition` comes from the IMA ad pod index. If the SDK reports an index for live pods that this tracker has not seen, a live pre-roll may be labelled `mid`.

## Best Practices

### 1. Setting `contentTitle`

The `contentTitle` attribute will display a value if your video metadata contains title information. For best results, set this attribute explicitly during initialization:

```javascript
const tracker = new HLSTracker(hls, {
  info: {
    licenseKey: 'YOUR_LICENSE_KEY',
    beacon: 'YOUR_BEACON_URL',
    applicationID: 'YOUR_APP_ID'
  },
  customData: {
    contentTitle: 'My Video Title'
  }
});
```

If your title changes dynamically (e.g., playlist or queue):

```javascript
tracker.sendOptions({
  customData: {
    contentTitle: 'New Video Title'
  }
});
```

### 2. Setting `userId`

Set a user identifier to track video analytics per user:

```javascript
const tracker = new HLSTracker(hls, {
  info: {
    licenseKey: 'YOUR_LICENSE_KEY',
    beacon: 'YOUR_BEACON_URL',
    applicationID: 'YOUR_APP_ID'
  },
  customData: {
    contentTitle: 'Video Title',
    userId: 'user-12345'
  }
});

// Or set userId separately using the API method
tracker.setUserId('user-12345');
```

### 3. Adding Custom Attributes for Your Deployment

Add custom attributes to improve data aggregation and analysis:

```javascript
const tracker = new HLSTracker(hls, {
  info: {
    licenseKey: 'YOUR_LICENSE_KEY',
    beacon: 'YOUR_BEACON_URL',
    applicationID: 'YOUR_APP_ID'
  },
  customData: {
    contentTitle: videoMetadata.title,
    userId: currentUser.id,
    subscriptionTier: 'premium',
    contentProvider: 'studio-abc',
    region: 'us-west-2',
    cdnProvider: 'cloudflare',
    deviceType: 'desktop',
    appVersion: '2.1.0',
    campaign: 'spring-promo'
  }
});
```

**Use these attributes in New Relic queries:**

```sql
-- Analyze by subscription tier
SELECT count(*) FROM VideoAction WHERE actionName = 'CONTENT_START'
FACET subscriptionTier SINCE 1 day ago

-- Monitor network performance by region
SELECT average(contentNetworkDownloadBitrate) FROM VideoAction
FACET region SINCE 1 hour ago
```

### 4. Gradual Rollout with Feature Flags

Use feature flags to enable the tracker gradually in production:

```javascript
const rolloutPercentage = 5; // Start with 5% of users

function shouldEnableTracking(userId) {
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (hash % 100) < rolloutPercentage;
}

if (Hls.isSupported() && shouldEnableTracking(currentUser.id)) {
  const hls = new Hls();
  hls.loadSource(videoSrc);
  hls.attachMedia(video);

  const tracker = new HLSTracker(hls, {
    info: {
      licenseKey: 'YOUR_LICENSE_KEY',
      beacon: 'YOUR_BEACON_URL',
      applicationID: 'YOUR_APP_ID'
    },
    customData: {
      contentTitle: videoMetadata.title,
      userId: currentUser.id,
      rolloutGroup: `${rolloutPercentage}%`
    }
  });
}
```

**Recommended Rollout Schedule:**

| Phase | Percentage | Duration | Validation |
|-------|-----------|----------|------------|
| Initial | 5% | 2–3 days | Verify data flowing to New Relic |
| Early | 15% | 3–5 days | Check data quality and performance |
| Expansion | 25% | 5–7 days | Validate across device types |
| Majority | 50% | 1–2 weeks | Monitor at scale |
| Full | 100% | Ongoing | Complete deployment |

## Configuration Options

### Custom Data

Add custom attributes to all events:

```javascript
customData: {
  contentTitle: 'My Video Title',       // Override video title
  customPlayerName: 'MyPlayer',         // Custom player identifier
  customPlayerVersion: '1.0.0',         // Custom player version
  userId: '12345',                      // User identifier
  contentSeries: 'Season 1',            // Series information
  // Add any custom attributes you need
}
```

> **Note:** There are reserved keywords used for default attributes (see [DATAMODEL.md](./DATAMODEL.md) for the complete list). Do not use these reserved keywords as custom attribute names, as they will be dropped.

> **Limit:** The maximum total number of custom attributes per event is **150**. Any attributes beyond this limit will be dropped.

## API Reference

### Core Methods

#### `tracker.setUserId(userId)`
Set a unique identifier for the current user.

```javascript
tracker.setUserId('user-12345');
```

#### `tracker.setHarvestInterval(milliseconds)`
Configure how frequently data is sent to New Relic. Accepts values between 1000ms (1 second) and 300000ms (5 minutes).

```javascript
tracker.setHarvestInterval(30000); // Send data every 30 seconds
```

#### Live Stream Configuration

**Recommendations for Live Content:**

For live streams, reduce the harvest interval to 5,000–10,000 ms for near-real-time data delivery:

```javascript
// Live content — flush every 5 seconds
tracker.setHarvestInterval(5000)

// VOD content — default 10s is sufficient or change it as required
```

#### `tracker.sendCustom(actionName, state, attributes)`
Send custom events with arbitrary attributes.

```javascript
tracker.sendCustom('VideoBookmarked', 'playing', {
  timestamp: Date.now(),
  position: hls.media.currentTime,
  userId: 'user-12345',
  bookmarkId: 'bookmark-789'
});
```

#### `tracker.sendOptions(options)`
Update tracker configuration after initialization.

```javascript
tracker.sendOptions({
  customData: {
    contentTitle: 'New Video Title',
    season: '1',
    episode: '3'
  }
});
```

### Example: Complete Integration

```javascript
import HLSTracker from '@newrelic/video-hls';

const video = document.getElementById('video');
const videoSrc = 'https://your-hls-stream.m3u8';

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(videoSrc);
  hls.attachMedia(video);

  const tracker = new HLSTracker(hls, {
    info: {
      licenseKey: 'YOUR_LICENSE_KEY',
      beacon: 'YOUR_BEACON_URL',
      applicationID: 'YOUR_APP_ID'
    }
  });

  // Set user context
  tracker.setUserId('user-12345');

  // Configure reporting interval
  tracker.setHarvestInterval(30000);

  // Send custom events
  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    tracker.sendCustom('QualityChanged', 'playing', {
      newLevel: hls.currentLevel,
      timestamp: Date.now()
    });
  });
}
```

## Bitrate Metrics

The tracker captures four distinct bitrate metrics providing complete quality analysis:

| Attribute | Description | Use Case |
|-----------|-------------|----------|
| `contentBitrate` | Bitrate (in bps) of the currently active HLS rendition | Monitor actual video quality being delivered |
| `contentManifestBitrate` | Maximum bitrate (in bps) across all renditions declared in the HLS manifest | Understand the highest quality available |
| `contentSegmentDownloadBitrate` | Per-segment download bandwidth (in bps) measured from the last loaded fragment | Analyze per-segment network conditions |
| `contentNetworkDownloadBitrate` | HLS.js bandwidth estimate (in bps) used by the ABR algorithm | Monitor real-time network performance |

### Bitrate Monitoring Example

```sql
-- Monitor average network bitrate over time
SELECT average(contentNetworkDownloadBitrate) FROM VideoAction
WHERE actionName = 'CONTENT_HEARTBEAT' TIMESERIES

-- Track rendition changes with before/after bitrates
SELECT contentBitrate FROM VideoAction
WHERE actionName = 'CONTENT_RENDITION_CHANGE' SINCE 1 hour ago
```

## Data Model

The tracker captures comprehensive video analytics across three event types:

- **VideoAction** - Playback events (play, pause, buffer, seek, quality changes, heartbeats)
- **VideoErrorAction** - Error events (HLS.js errors, media pipeline failures)
- **VideoCustomAction** - Custom events defined by your application

**Full Documentation:** See [DATAMODEL.md](./DATAMODEL.md) for complete event and attribute reference.

## Support

Should you need assistance with New Relic products, you are in good hands with several support channels.

If the issue has been confirmed as a bug or is a feature request, please file a GitHub issue.

### Support Channels

- [New Relic Documentation](https://docs.newrelic.com): Comprehensive guidance for using our platform
- [New Relic Community](https://discuss.newrelic.com): The best place to engage in troubleshooting questions
- [New Relic University](https://learn.newrelic.com): A range of online training for New Relic users of every level
- [New Relic Technical Support](https://support.newrelic.com): 24/7/365 ticketed support. Read more about our [Technical Support Offerings](https://docs.newrelic.com/docs/licenses/license-information/general-usage-licenses/support-plan)

## Contribute

We encourage your contributions to improve the HLS.js Tracker! Keep in mind that when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project.

If you have any questions, or to execute our corporate CLA (which is required if your contribution is on behalf of a company), drop us an email at opensource@newrelic.com.

For more details on how best to contribute, see [CONTRIBUTING.md](./CONTRIBUTING.md).

### A note about vulnerabilities

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through our [bug bounty program](https://docs.newrelic.com/docs/security/security-privacy/information-security/report-security-vulnerabilities/).

If you would like to contribute to this project, review [these guidelines](./CONTRIBUTING.md).

To all contributors, we thank you! Without your contribution, this project would not be what it is today.

## License

The HLS.js Tracker is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.

The HLS.js Tracker also uses source code from third-party libraries. Full details on which libraries are used and the terms under which they are licensed can be found in the [third-party notices document](./THIRD_PARTY_NOTICES.md).
