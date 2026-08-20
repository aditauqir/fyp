const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /function findWatchPlaylistHost\(/);
assert.match(source, /ytd-playlist-panel-renderer/);
assert.match(source, /!element\.closest\('ytd-miniplayer'\)/);
assert.match(source, /new URLSearchParams\(location\.search\)\.has\('list'\)/);
assert.doesNotMatch(
  source,
  /ytd-watch-next-secondary-results-renderer'\) \|\|\s*watch\.querySelector\('#secondary'\)/
);
assert.match(source, /watch\.querySelector\('#related'\)/);
assert.match(
  source,
  /setImportantStyles\(playlist, \{\s*order: '2'/
);
assert.match(
  source,
  /setImportantStyles\(recommendations, \{\s*order: '3'/
);
assert.match(
  source,
  /if \(comments\) \{\s*setImportantStyles\(comments, \{\s*order: '4'/
);
assert.match(
  source,
  /descriptionBlock\.insertAdjacentElement\('afterend', playlist\)/
);
assert.match(
  source,
  /ytd-watch-flexy #below ytd-playlist-panel-renderer/
);
assert.match(
  source,
  /ytd-watch-flexy #below ytd-playlist-panel-renderer #items/
);
assert.match(source, /max-height: min\(42vh, 22rem\)/);
assert.match(source, /ytd-browse\[page-subtype='playlist'\]/);

console.log('watch playlist panel stays below the description: ok');
