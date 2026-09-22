## [2.0.0](https://github.com/newrelic/video-hls-js/compare/v1.0.1...v2.0.0) (2026-09-22)

### New features

- **`/browser` subpath export:** A `@newrelic/video-hls/browser` entry point is
  now available that excludes unused Vega/connected-device code, reducing bundle
  size for browser consumers. A `browser.js` filesystem shim is also included for
  bundlers that don't honor the `exports` field.
- **Named export:** `{ HLSTracker }` is now available as a named export alongside
  the existing default export on both the root and `/browser` entry points.

### Improvements

- **`@newrelic/video-core` updated to 5.1.0**, which includes TypeScript
  declaration files, upstream bug fixes, and dependency patches.

## [1.0.1](https://github.com/newrelic/video-hls-js/compare/v1.0.0...v1.0.1) (2026-07-15)


### Bug Fixes

* align tests with updated tracker behavior ([73d4071](https://github.com/newrelic/video-hls-js/commit/73d407174d6742232fc51f5173f37debefd15312))
* instrumention version and tracker rectified ([9dadc5c](https://github.com/newrelic/video-hls-js/commit/9dadc5ce8f08f2fa892bb8ec9c275ad91596213b))

# CHANGELOG
