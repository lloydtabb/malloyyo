// Unit tests for the pieces of `malloyyo login` that decide HOW the browser
// round trip happens — which is what makes the command usable (or not) in a
// container, over SSH, or in CI. No network: the OAuth exchange itself is
// covered by the publish-flow integration test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { browserless, listenTarget, openBrowser } from '../src/oauth.js';

test('listens on any free loopback port by default', () => {
  assert.deepEqual(listenTarget({}), { host: '127.0.0.1', port: 0 });
});

test('an empty MALLOYYO_OAUTH_PORT is the same as not setting it', () => {
  assert.deepEqual(listenTarget({ MALLOYYO_OAUTH_PORT: '' }), { host: '127.0.0.1', port: 0 });
});

test('a fixed port can be pinned so a container can publish it', () => {
  assert.deepEqual(listenTarget({ MALLOYYO_OAUTH_PORT: '41121' }), {
    host: '127.0.0.1',
    port: 41121,
  });
});

test('the bind host is settable, because a published port arrives off-loopback', () => {
  // Inside a container, `docker run -p` forwards to the container's own
  // interface. Bound to 127.0.0.1 there, the listener refuses the connection
  // and sign-in dies at the redirect.
  assert.deepEqual(
    listenTarget({ MALLOYYO_OAUTH_PORT: '41121', MALLOYYO_OAUTH_HOST: '0.0.0.0' }),
    { host: '0.0.0.0', port: 41121 },
  );
});

test('a port that is not a port is rejected by name', () => {
  for (const bad of ['abc', '0', '-1', '70000', '1.5', ' ']) {
    assert.throws(
      () => listenTarget({ MALLOYYO_OAUTH_PORT: bad }),
      /MALLOYYO_OAUTH_PORT/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('macOS and Windows always have a browser to open', () => {
  assert.equal(browserless('darwin', {}), false);
  assert.equal(browserless('win32', {}), false);
});

test('Linux has a browser only when a display server is present', () => {
  assert.equal(browserless('linux', {}), true);
  assert.equal(browserless('linux', { DISPLAY: ':0' }), false);
  assert.equal(browserless('linux', { WAYLAND_DISPLAY: 'wayland-0' }), false);
});

/** Whether `name` is executable on PATH — used to run the next test only where
    the opener really is missing, so it never launches a browser on a laptop. */
function onPath(name: string): boolean {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((dir) => dir && existsSync(join(dir, name)));
}

const openerMissing = process.platform === 'linux' && !onPath('xdg-open');

test(
  'a missing browser opener does not take the process down',
  {
    skip: openerMissing ? false : 'needs a Linux host with no xdg-open (a container)',
  },
  async () => {
    // spawn() reports ENOENT asynchronously as an 'error' event. With no
    // listener Node rethrows it as an uncaught exception, which killed the CLI
    // one line after it printed the URL meant to be the fallback. If that
    // listener is ever removed, this test process dies here instead of failing.
    openBrowser('http://127.0.0.1:1/never-opened');
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(true, 'still running after the opener failed');
  },
);
