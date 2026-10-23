import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const snippet = readFileSync(new URL('../caddy/design-source-integrity.snippet', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../compose.netcup.yaml', import.meta.url), 'utf8');
const figma = JSON.parse(readFileSync(new URL('../mcp.figma.remote.json', import.meta.url), 'utf8'));

test('only raw project GET/HEAD requests receive the deferred no-transform header', () => {
  assert.match(snippet, /method GET HEAD/);
  assert.match(snippet, /header @design_raw_source >Cache-Control "no-cache, no-transform"/);
  const pattern = snippet.match(/path_regexp design_raw_source (.+)/)?.[1];
  assert.ok(pattern);
  const matcher = new RegExp(pattern);
  for (const path of ['/api/projects/project-id/raw/index.html', '/api/projects/project-id/raw/assets/logo.png']) {
    assert.equal(matcher.test(path), true);
  }
  for (const path of ['/', '/api/media/config', '/api/projects/project-id/files/index.html', '/files/index.html', '/api/projects/project-id/raw/', '/api/projects/one/two/raw/index.html']) {
    assert.equal(matcher.test(path), false);
  }
  assert.equal(snippet.includes('Access-Control-Allow-Origin'), false);
});

test('the deployment cannot silently pull a newer image or enable an updater', () => {
  assert.match(compose, /image: "sha256:[a-f0-9]{64}"/);
  assert.match(compose, /pull_policy: never/);
  assert.match(compose, /com\.centurylinklabs\.watchtower\.enable: "false"/);
  assert.match(compose, /OD_PUBLIC_BASE_URL: "https:\/\/design\.alpon\.xyz"/);
  for (const key of ['OD_UPDATE_ENABLED', 'OD_UPDATE_AUTO_CHECK', 'OD_UPDATE_AUTO_DOWNLOAD', 'OD_UPDATE_AUTO_OPEN']) {
    assert.ok(compose.includes(`${key}: "0"`));
  }
});

test('official Figma replaces the unreachable desktop endpoint without claiming authorization', () => {
  assert.equal(figma.id, 'figma-use');
  assert.equal(figma.url, 'https://mcp.figma.com/mcp');
  assert.equal(figma.authMode, 'oauth');
  assert.equal(figma.enabled, false);
  assert.equal('templateId' in figma, false);
  assert.equal('headers' in figma, false);
});
