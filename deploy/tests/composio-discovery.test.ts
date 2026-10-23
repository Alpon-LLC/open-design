import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import normalizer from '../normalize-opencode-global.cjs';

const instructions = () => readFileSync(new URL('../opencode/AGENTS.md', import.meta.url), 'utf8');

test('V2 active global instructions require live catalog discovery before denying availability', () => {
  const text = instructions();
  assert.match(text, /COMPOSIO_SEARCH_TOOLS/);
  assert.match(text, /before saying.*unavailable|before.*not connected/i);
  assert.match(text, /initial tool list.*not.*connection/i);
  assert.match(text, /Code Mode/);
  assert.match(text, /any MCP.*Composio first/i);
  assert.match(text, /separately configured MCP.*native connector/i);
});

test('all previously approved design integrations remain discoverable with bounded native tools', () => {
  const text = instructions();
  for (const name of ['Mobbin', 'Pexels', 'IconScout']) assert.ok(text.includes(name));
  assert.match(text, /MOBBIN_MCP_/);
  assert.match(text, /COMPOSIO_MULTI_EXECUTE_TOOL/);
  assert.match(text, /search_strategy.*tool_search/);
  assert.match(text, /bounded/i);
});

test('recognition guidance does not widen permissions, expose secrets, or invent successful connections', () => {
  const text = instructions();
  assert.match(text, /Do not.*allowlists/i);
  assert.match(text, /Do not.*credentials/i);
  assert.match(text, /restricted.*disconnected/i);
  assert.match(text, /returned.*connection status/i);
});

const raw = {
  model: 'fixture/model', provider: { fixture: { options: { apiKey: 'fixture-only' } } },
  mcp: { servers: { composio: { type: 'remote', url: 'https://fixture.invalid/mcp',
    headers: { Authorization: 'Bearer fixture-only' }, oauth: false, disabled: false, timeout: 30000 } } },
};
const runtimeInfo = { model: { providerID: 'fixture', model: 'model' },
  providers: { fixture: { settings: { api_key: 'fixture-only' } } } };

test('normalization removes the V1 marker without guessing or changing the native provider projection', () => {
  const normalized = normalizer.normalizeOpenCodeGlobal(raw, runtimeInfo);
  assert.equal(normalized.provider, undefined);
  assert.deepEqual(normalized.providers, runtimeInfo.providers);
  assert.deepEqual(normalized.model, runtimeInfo.model);
});

test('MCP normalization preserves authority and the original timeout bound', () => {
  const normalized = normalizer.normalizeOpenCodeGlobal(raw, runtimeInfo);
  const { timeout, ...before } = raw.mcp.servers.composio;
  const { timeout: afterTimeout, ...after } = normalized.mcp.servers.composio;
  assert.deepEqual(after, before);
  assert.deepEqual(afterTimeout, { startup: timeout, catalog: timeout, execution: timeout });
});

test('normalization refuses unrelated or incomplete runtime projections', () => {
  assert.throws(() => normalizer.normalizeOpenCodeGlobal(raw, { ...runtimeInfo, model: 'other/model' }));
  assert.throws(() => normalizer.normalizeOpenCodeGlobal(raw, { ...runtimeInfo, providers: {} }));
  assert.throws(() => normalizer.normalizeOpenCodeGlobal({ ...raw, providers: runtimeInfo.providers }, runtimeInfo));
});
