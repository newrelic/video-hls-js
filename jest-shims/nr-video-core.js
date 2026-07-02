// @newrelic/video-core ships a webpack CJS bundle whose export shape is:
//   { nrvideo: { default: { VideoTracker, Core, Log, ... } } }
// Babel's interopRequireDefault stops one level too early, making
// nrvideo.VideoTracker undefined. This shim flattens the real export
// so the import works identically to the ESM path in production.
const real = require('../node_modules/@newrelic/video-core/dist/cjs/index.js').nrvideo.default;
module.exports = { ...real, default: real, __esModule: true };
