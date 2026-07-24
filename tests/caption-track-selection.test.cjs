const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);
const start = source.indexOf('  function captionTrackLabel(track)');
const end = source.indexOf(
  '  function suppressDuplicateNativeCaptions(',
  start
);
assert.ok(start >= 0 && end > start, 'caption ranking helpers');
const helpers = source.slice(start, end);

function choose(tracks) {
  const context = { tracks, selected: null };
  vm.runInNewContext(
    `${helpers}\nselected = chooseBestCaptionTrack(tracks);`,
    context
  );
  return context.selected;
}

const authoredEnglish = {
  label: 'English (United States)',
  language: 'en-US',
  mode: 'showing',
};
const automaticEnglish = {
  label: 'English (auto-generated)',
  language: 'en',
  mode: 'showing',
};
const authoredSpanish = {
  label: 'Español',
  language: 'es',
  mode: 'showing',
};

assert.equal(
  choose([automaticEnglish, authoredSpanish, authoredEnglish]),
  authoredEnglish
);
assert.equal(
  choose([authoredSpanish, automaticEnglish]),
  automaticEnglish
);
assert.equal(choose([authoredSpanish]), authoredSpanish);

console.log('caption ranking prefers authored English then automatic English: ok');
