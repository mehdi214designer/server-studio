// Version comparison for the update badge. Its own file so the test can require it
// directly: it used to live in server.js, and the test regex-matched the function out
// of the source and evaluated it dynamically, because requiring server.js starts a server.
// Evaluating your own source to test it is a bad habit even when the input is trusted.
'use strict';

// True when a is a higher version than b. Numeric per part, so 1.10.0 beats 1.9.0.
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

module.exports = { isNewer };
