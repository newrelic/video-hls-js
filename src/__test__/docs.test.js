import fs from 'fs';
import path from 'path';

// Two documented facts are load-bearing for customers and easy to lose in a
// later docs tidy-up, so they are pinned here rather than left to review.
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

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
