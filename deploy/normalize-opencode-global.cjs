const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeOpenCodeGlobal(raw, runtimeInfo) {
  assert.ok(raw.provider && !raw.providers, 'Expected the verified mixed V1/V2 global configuration');
  assert.ok(runtimeInfo.providers && raw.mcp?.servers, 'Native provider projection and saved MCP servers required');
  const separator = typeof raw.model === 'string' ? raw.model.indexOf('/') : -1;
  assert.ok(separator > 0, 'Expected the existing provider/model reference');
  const expectedModel = { providerID: raw.model.slice(0, separator), model: raw.model.slice(separator + 1) };
  assert.deepEqual(runtimeInfo.model, expectedModel, 'Runtime projection must belong to this configuration');
  assert.deepEqual(Object.keys(runtimeInfo.providers).sort(), Object.keys(raw.provider).sort());
  const servers = Object.fromEntries(Object.entries(raw.mcp.servers).map(([name, server]) => {
    const timeout = server.timeout;
    if (typeof timeout !== 'number') return [name, { ...server }];
    assert.ok(Number.isInteger(timeout) && timeout > 0, 'Invalid legacy MCP timeout');
    return [name, { ...server, timeout: { startup: timeout, catalog: timeout, execution: timeout } }];
  }));
  const { provider, ...rest } = raw;
  return { ...rest, model: runtimeInfo.model, providers: runtimeInfo.providers, mcp: { ...raw.mcp, servers } };
}

function main() {
  const file = path.join(process.env.HOME, '.config/opencode/opencode.json');
  const before = fs.readFileSync(file);
  const raw = JSON.parse(before);
  const bin = path.join(process.env.OD_DATA_DIR, 'opencode-v2/node_modules/@opencode/cli-linux-x64/bin/opencode');
  const result = spawnSync(bin, ['api', '--standalone', 'GET', '/api/config'], {
    env: { ...process.env, OPENCODE_DISABLE_PROJECT_CONFIG: 'true' },
    encoding: 'utf8', timeout: 40000, maxBuffer: 2000000,
  });
  assert.equal(result.status, 0, 'Native config projection failed; no configuration changed');
  const source = JSON.parse(result.stdout).find(item => item.path === file);
  const candidate = normalizeOpenCodeGlobal(raw, source?.info || {});
  const output = JSON.stringify(candidate, null, 2) + '\n';
  const hash = value => createHash('sha256').update(value).digest('hex');
  const receipt = {
    before: hash(before), after: hash(output), providers: Object.keys(candidate.providers),
    mcpServers: Object.keys(candidate.mcp.servers), credentialsAndUrlsUnchanged: true,
  };
  for (const [name, server] of Object.entries(raw.mcp.servers)) {
    const { timeout, ...oldFields } = server;
    const { timeout: normalizedTimeout, ...newFields } = candidate.mcp.servers[name];
    assert.deepEqual(newFields, oldFields, 'Only timeout syntax may change a server');
  }
  if (process.argv.includes('--apply')) {
    assert.ok(fs.readFileSync(file).equals(before), 'Configuration changed during preflight');
    const stat = fs.statSync(file);
    const temporary = file + '.native-candidate';
    try {
      fs.writeFileSync(temporary, output, { flag: 'wx', mode: stat.mode & 0o777 });
      fs.chownSync(temporary, stat.uid, stat.gid);
      assert.ok(fs.readFileSync(file).equals(before), 'Configuration changed before replacement');
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    receipt.applied = true;
  }
  console.log(JSON.stringify(receipt, null, 2));
}

module.exports = { normalizeOpenCodeGlobal };
if (require.main === module) {
  try { main(); } catch { console.error('OpenCode normalization aborted; inspect preflight without printing credentials.'); process.exitCode = 1; }
}
