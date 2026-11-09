import fs from 'fs';
import path from 'path';

// Two documented facts are load-bearing for customers and easy to lose in a
// later docs tidy-up, so they are pinned here rather than left to review.
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Dropping `data.fatal === false` changes the data of EVERY hls.js consumer,
// DAI or not: non-fatal errors — including fragLoadError retries that carry
// real CDN signal — stop being reported, so numberOfErrors and
// hadPlaybackError alert thresholds shift on upgrade. The behaviour is
// deliberate, but it has to be discoverable before a customer upgrades.
//
// CHANGELOG.md is written by @semantic-release/changelog at release time, so
// the note lives in the README, which is what ships to customers.
describe('README.md — the non-fatal error filter upgrade note', () => {
  it('carries a prominent upgrade note about non-fatal errors', () => {
    const readme = read('README.md');
    expect(readme).toContain('## Upgrade notes');
    const note = readme.slice(readme.indexOf('## Upgrade notes'));
    expect(note).toMatch(/non-fatal/i);
    expect(note).toContain('numberOfErrors');
    expect(note).toContain('hadPlaybackError');
    // It applies with or without an ads tracker — that is the whole point.
    expect(note).toMatch(/fragLoadError/);
  });

  it('links the upgrade note from the table of contents', () => {
    const readme = read('README.md');
    expect(readme).toContain('- [Upgrade notes](#upgrade-notes)');
  });
});

describe('DATAMODEL.md — the DAI ad clock', () => {
  // adPlayhead comes from the SDK's adProgressData.currentTime, which tops out
  // just short of ad.getDuration() (measured 9538ms against 10000ms). A
  // dashboard written `adPlayhead >= adDuration` therefore never fires, so the
  // caveat has to be discoverable from the data model.
  it('documents that adPlayhead never reaches adDuration', () => {
    const datamodel = read('DATAMODEL.md');
    expect(datamodel).toContain('adProgressData.currentTime');
    expect(datamodel).toContain('adPlayhead >= adDuration');
    expect(datamodel).toMatch(/99\.7/);
  });
});
