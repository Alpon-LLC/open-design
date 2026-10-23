#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const exposedModels = [
  'alpon-9router/openai/gpt-5.6-sol',
  'alpon-9router/openai/gpt-5.6-terra',
  'alpon-9router/openai/gpt-5.6-luna',
  'alpon-9router/openai/gpt-6-astra',
];

const aliases = new Map([
  ['alpon-9router/openai/gpt-5.6-sol', 'alpon-9router/cx/gpt-5.6-sol'],
  ['alpon-9router/openai/gpt-5.6-terra', 'alpon-9router/cx/gpt-5.6-terra'],
  ['alpon-9router/openai/gpt-5.6-luna', 'alpon-9router/cx/gpt-5.6-luna'],
  ['alpon-9router/openai/gpt-6-astra', 'alpon-9router/cx/gpt-6-astra'],
  ['openai/gpt-5.6-sol', 'alpon-9router/cx/gpt-5.6-sol'],
  ['openai/gpt-5.6-terra', 'alpon-9router/cx/gpt-5.6-terra'],
  ['openai/gpt-5.6-luna', 'alpon-9router/cx/gpt-5.6-luna'],
  ['openai/gpt-6-astra', 'alpon-9router/cx/gpt-6-astra'],
]);

const processArgs = process.argv.slice(2);

function migrateV1ConfigContent(raw) {
  if (!raw) return raw;
  try {
    const config = JSON.parse(raw);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return raw;

    if (
      config.mcp &&
      typeof config.mcp === 'object' &&
      !Array.isArray(config.mcp) &&
      !config.mcp.servers
    ) {
      const servers = {};
      for (const [id, value] of Object.entries(config.mcp)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const entry = { ...value };
        if ('enabled' in entry) {
          entry.disabled = entry.enabled === false;
          delete entry.enabled;
        }
        if (
          entry.type === 'remote' &&
          entry.oauth === undefined &&
          entry.headers &&
          typeof entry.headers === 'object'
        ) {
          entry.oauth = false;
        }
        servers[id] = entry;
      }
      config.mcp = { servers };
    }

    const externalDirectory = config.permission?.external_directory;
    if (
      externalDirectory &&
      typeof externalDirectory === 'object' &&
      !Array.isArray(externalDirectory)
    ) {
      const permissions = Array.isArray(config.permissions)
        ? [...config.permissions]
        : [];
      for (const [resource, effect] of Object.entries(externalDirectory)) {
        if (!['allow', 'ask', 'deny'].includes(effect)) continue;
        permissions.push({ action: 'external_directory', resource, effect });
      }
      config.permissions = permissions;
      const remainingPermission = { ...config.permission };
      delete remainingPermission.external_directory;
      if (Object.keys(remainingPermission).length > 0) {
        config.permission = remainingPermission;
      } else {
        delete config.permission;
      }
    }

    return JSON.stringify(config);
  } catch {
    return raw;
  }
}

if (processArgs[0] === 'models' && !processArgs.includes('--help')) {
  const metadata = JSON.stringify(
    { variants: { low: {}, medium: {}, high: {} } },
    null,
    2,
  );
  for (const model of exposedModels) process.stdout.write(`${model}\n${metadata}\n`);
  process.exit(0);
}

function mapModel(model) {
  const separator = model.lastIndexOf('#');
  const base = separator >= 0 ? model.slice(0, separator) : model;
  const variant = separator >= 0 ? model.slice(separator) : '';
  return `${aliases.get(base) || base}${variant}`;
}

let cwd;
let legacyVariant;
let modelIndex = -1;
const args = [];

for (let index = 0; index < processArgs.length; index += 1) {
  const value = processArgs[index];
  if (value === '--dir') {
    cwd = processArgs[index + 1];
    index += 1;
    continue;
  }
  if (value === '--variant') {
    legacyVariant = processArgs[index + 1];
    index += 1;
    continue;
  }
  if ((value === '--model' || value === '-m') && index + 1 < processArgs.length) {
    args.push(value, mapModel(processArgs[index + 1]));
    modelIndex = args.length - 1;
    index += 1;
    continue;
  }
  args.push(value);
}

if (
  legacyVariant &&
  modelIndex >= 0 &&
  ['low', 'medium', 'high'].includes(legacyVariant) &&
  !args[modelIndex].includes('#')
) {
  args[modelIndex] = `${args[modelIndex]}#${legacyVariant}`;
}

// OpenCode V2 moved session export under `session export`. OpenDesign's
// child-run evidence loader still invokes the former top-level command.
if (args[0] === 'export') {
  args.splice(0, 1, 'session', 'export');
}

const command = args[0];
const isSessionExport = command === 'session' && args[1] === 'export';
if (command === 'run') {
  if (!args.includes('--standalone')) args.splice(1, 0, '--standalone');
  if (!args.includes('--auto')) args.splice(2, 0, '--auto');
} else if (command === 'models' || isSessionExport) {
  if (!args.includes('--standalone')) args.splice(isSessionExport ? 2 : 1, 0, '--standalone');
}

const real =
  process.env.OPENCODE_V2_BIN ||
  '/opt/opendesign/data/opencode-v2/node_modules/@opencode/cli-linux-x64/bin/opencode';
const childEnv = { ...process.env };
if (childEnv.OPENCODE_CONFIG_CONTENT) {
  childEnv.OPENCODE_CONFIG_CONTENT = migrateV1ConfigContent(
    childEnv.OPENCODE_CONFIG_CONTENT,
  );
}
const result = spawnSync(real, args, {
  cwd: cwd || process.cwd(),
  env: childEnv,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(127);
}
process.exit(result.status === null ? 1 : result.status);
