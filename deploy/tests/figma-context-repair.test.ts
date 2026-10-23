import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { retireUnconfiguredFigmaContext } from '../figma-context-repair.ts';

const broken = { id: 'figma-context', templateId: 'figma-context', enabled: true,
  transport: 'stdio', command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'] };

test('selected Figma Context without credentials is retired with an actionable, non-OAuth diagnosis', () => {
  const other = { id: 'other', enabled: true, transport: 'http', url: 'https://fixture.invalid' };
  const config = { servers: [broken, other] };
  const result = retireUnconfiguredFigmaContext(config, {});
  assert.equal(result.servers[0].enabled, false);
  assert.match(result.servers[0].label!, /missing token/i);
  assert.match(result.servers[0].label!, /Connectors.*Figma/);
  assert.doesNotMatch(result.servers[0].label!, /disconnected/i);
  assert.deepEqual(result.servers[1], other);
  assert.equal(config.servers[0].enabled, true);
  assert.deepEqual(retireUnconfiguredFigmaContext(result, {}), result);
});

test('never retire an authenticated, inherited, custom, or unrecognized MCP server', () => {
  for (const name of ['FIGMA_API_KEY', 'FIGMA_OAUTH_TOKEN']) {
    const config = { servers: [{ ...broken, env: { [name]: 'fixture-only' } }] };
    assert.deepEqual(retireUnconfiguredFigmaContext(config, {}), config);
    assert.deepEqual(retireUnconfiguredFigmaContext({ servers: [broken] }, { [name]: 'fixture-only' }), { servers: [broken] });
    // Empty explicit values override inherited environment in MCP spawning.
    assert.equal(retireUnconfiguredFigmaContext({ servers: [{ ...broken, env: { [name]: '' } }] }, { [name]: 'fixture-only' }).servers[0].enabled, false);
  }
  for (const server of [
    { ...broken, command: '/custom/figma' },
    { ...broken, args: [...broken.args, '--figma-api-key=fixture-only'] },
    { ...broken, args: [...broken.args, '--figma-oauth-token', 'fixture-only'] },
    { ...broken, args: [...broken.args, '--env', '/custom/.env'] },
    { ...broken, transport: 'http' },
  ]) assert.deepEqual(retireUnconfiguredFigmaContext({ servers: [server] }, {}), { servers: [server] });
});

test('native connector discovery is not blocked by an unrelated global Composio session', () => {
  const guidance = readFileSync(new URL('../opencode/AGENTS.md', import.meta.url), 'utf8');
  assert.match(guidance, /selected native connector.*first/i);
  assert.match(guidance, /tools connectors list --format compact/);
  assert.match(guidance, /global Composio.*not.*native connector/i);
  assert.match(guidance, /FIGMA_API_KEY.*FIGMA_OAUTH_TOKEN/);
  assert.match(guidance, /node.*text.*metadata/i);
});
