#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import type { Stats } from 'node:fs';
import { promisify } from 'node:util';
import {
  chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeSkillBody,
  mergeSkillDocument,
  parseGitHubSource,
  type AdvertisedSkillsLock,
  type LockedSkill,
} from './advertised-skills-lib.ts';
import { SOURCE_OVERRIDES } from './advertised-skills-sources.ts';

const execFile = promisify(execFileCallback);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SKILLS_ROOT = path.join(REPO_ROOT, 'skills');
const LOCK_PATH = path.join(REPO_ROOT, 'advertised-skills.lock.json');
const MAX_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_DIRECTORIES = new Set([
  '.github', 'node_modules', 'venv', '.venv', '__pycache__', '.cache',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'dist', 'build',
]);
const SECRET_NAME = /^(?:\.env(?:\..*)?|auth(?:\.json)?|credentials?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;
const LICENSE_NAME = /^(?:licen[cs]e|copying|notice|copyright)(?:\..*)?$/i;

interface CatalogueEntry {
  id: string;
  directory: string;
  document: string;
  upstream: string;
}

interface ResolvedSource {
  repo: string;
  commit: string;
  path: string;
  bodyFile: string;
  official: boolean;
  stars: number;
  evidence: string;
}

async function run(command: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFile(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

async function catalogue(): Promise<CatalogueEntry[]> {
  const result: CatalogueEntry[] = [];
  for (const entry of (await readdir(SKILLS_ROOT, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(SKILLS_ROOT, entry.name);
    const document = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
    const upstream = document.match(/^  upstream:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
    if (upstream) result.push({ id: entry.name, directory, document, upstream });
  }
  return result;
}

function repositoryUrl(input: string): string {
  const parsed = parseGitHubSource(input);
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

async function cloneAt(repo: string, commit: string | undefined, ref: string | undefined, destination: string): Promise<string> {
  await run('git', ['clone', '--filter=blob:none', '--no-checkout', '--quiet', `${repo}.git`, destination]);
  let target = 'HEAD';
  if (commit) {
    await run('git', ['fetch', '--quiet', '--depth=1', 'origin', commit], destination);
    target = commit;
  } else if (ref) {
    await run('git', ['fetch', '--quiet', '--depth=1', 'origin', ref], destination);
    target = 'FETCH_HEAD';
  }
  return run('git', ['rev-parse', target], destination);
}

async function findSkillDirectories(root: string, commit: string): Promise<string[]> {
  const tree = await run('git', ['ls-tree', '-r', '--name-only', commit], root);
  return tree.split('\n')
    .filter((relative) => relative.toLowerCase().endsWith('/skill.md') || relative.toLowerCase() === 'skill.md')
    .filter((relative) => !relative.split('/').some((part) => part === '.git' || FORBIDDEN_DIRECTORIES.has(part.toLowerCase())))
    .map((relative) => path.join(root, path.dirname(relative)))
    .sort();
}

async function materializeSparse(root: string, commit: string, paths: Set<string>, nextPath: string): Promise<void> {
  paths.add(nextPath === '.' ? '.' : nextPath);
  if (paths.has('.')) {
    try {
      await run('git', ['sparse-checkout', 'disable'], root);
    } catch { /* a full checkout is already active */ }
    await run('git', ['checkout', '--quiet', '--detach', commit], root);
    return;
  }
  await run('git', ['sparse-checkout', 'init', '--cone'], root);
  await run('git', ['sparse-checkout', 'set', '--cone', ...[...paths].sort()], root);
  await run('git', ['checkout', '--quiet', '--detach', commit], root);
}

async function githubStars(repo: string): Promise<number> {
  const parsed = parseGitHubSource(repo);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'open-design-advertised-skill-sync' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
    if (!response.ok) return 0;
    const data = await response.json() as { stargazers_count?: number };
    return data.stargazers_count ?? 0;
  } catch {
    return 0;
  }
}

function hash(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
      else count += 1;
    }
  }
  await visit(root);
  return count;
}

function unsafeReason(relative: string, details: Stats): string | undefined {
  const parts = relative.split('/');
  if (parts.some((part) => FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))) return 'forbidden directory';
  const basename = parts.at(-1) ?? '';
  if (SECRET_NAME.test(basename)) return 'secret-like filename';
  if (details.isSymbolicLink()) return 'symlink';
  if (details.isFile() && details.size > MAX_BYTES) return 'file larger than 10 MiB';
  // Executable regular files are retained as data and chmod strips execution bits.
  return undefined;
}

async function copySafeTree(
  source: string,
  destination: string,
  options: { allowFiles?: string[]; allowUnsafe?: string[] } = {},
): Promise<{ skipped: number; reasons: string[] }> {
  let skipped = 0;
  const reasons: string[] = [];
  async function visit(from: string, to: string, relativeRoot: string): Promise<void> {
    await mkdir(to, { recursive: true });
    for (const entry of (await readdir(from, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const absolute = path.join(from, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      if (options.allowFiles && !options.allowFiles.some((allowed) => relative === allowed || relative.startsWith(`${allowed}/`))) continue;
      const details = await lstat(absolute);
      const reason = unsafeReason(relative, details);
      if (reason) {
        const amount = details.isDirectory() ? await countFiles(absolute) : 1;
        skipped += amount;
        reasons.push(`${relative}: ${reason}`);
        continue;
      }
      if (details.isDirectory()) await visit(absolute, path.join(to, entry.name), relative);
      else if (details.isFile()) {
        await copyFile(absolute, path.join(to, entry.name));
        await chmod(path.join(to, entry.name), details.mode & 0o666);
      } else {
        skipped += 1;
        reasons.push(`${relative}: unsupported filesystem entry`);
      }
    }
  }
  await visit(source, destination, '');
  return { skipped, reasons };
}

async function directLicenseFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && LICENSE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function snapshotLocal(directory: string): Promise<Pick<LockedSkill, 'files' | 'hashes' | 'bytes'>> {
  const files: string[] = [];
  const hashes: Record<string, string> = {};
  let bytes = 0;
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join('/');
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) throw new Error(`Vendored output contains symlink: ${relative}`);
      if (details.isDirectory()) await visit(absolute);
      else if (details.isFile()) {
        const body = await readFile(absolute);
        files.push(relative);
        hashes[relative] = hash(body);
        bytes += body.byteLength;
      }
    }
  }
  await visit(directory);
  return { files, hashes, bytes };
}

async function main(): Promise<void> {
  const updateLock = process.argv.includes('--update-lock');
  const entries = await catalogue();
  const previous = updateLock ? undefined : JSON.parse(await readFile(LOCK_PATH, 'utf8')) as AdvertisedSkillsLock;
  const workspace = await mkdtemp(path.join(tmpdir(), 'od-advertised-skills-'));
  const checkoutCache = new Map<string, { root: string; commit: string; paths: Set<string> }>();
  const starsCache = new Map<string, number>();
  const next: AdvertisedSkillsLock = { version: 1, skills: {} };

  try {
    for (const entry of entries) {
      const override = SOURCE_OVERRIDES[entry.id];
      const advertised = entry.upstream.includes('github.com') ? parseGitHubSource(entry.upstream) : undefined;
      const locked = previous?.skills[entry.id];
      if (override?.excluded) {
        const local = await snapshotLocal(entry.directory);
        next.skills[entry.id] = {
          source: locked?.source ?? (advertised ? repositoryUrl(entry.upstream) : entry.upstream),
          commit: locked?.commit ?? '0000000000000000000000000000000000000000',
          path: locked?.path ?? advertised?.subpath ?? '.',
          ...local,
          status: 'excluded',
          blocker: override.excluded,
          selection: { official: false, stars: locked?.selection.stars ?? 0, exactName: true, evidence: override.evidence },
        };
        process.stdout.write(`excluded ${entry.id}: ${override.excluded}\n`);
        continue;
      }
      if (!updateLock && locked?.status === 'unresolved') {
        next.skills[entry.id] = locked;
        process.stdout.write(`unresolved ${entry.id}: pinned licensing blocker\n`);
        continue;
      }
      const repo = locked?.source ?? override?.repo ?? (advertised ? repositoryUrl(entry.upstream) : undefined);
      if (!repo) throw new Error(`${entry.id}: non-GitHub source requires an explicit canonical repository override`);
      const requestedCommit = locked?.commit ?? override?.commit;
      const ref = requestedCommit ? undefined : advertised?.ref;
      const cacheKey = `${repo}@${requestedCommit ?? ref ?? 'HEAD'}`;
      let checkout = checkoutCache.get(cacheKey);
      if (!checkout) {
        const root = path.join(workspace, hash(cacheKey).slice(0, 16));
        const commit = await cloneAt(repo, requestedCommit, ref, root);
        checkout = { root, commit, paths: new Set<string>() };
        checkoutCache.set(cacheKey, checkout);
      }

      let sourcePath = locked?.path ?? override?.path ?? advertised?.subpath;
      if (!sourcePath) {
        const directories = await findSkillDirectories(checkout.root, checkout.commit);
        const matches = directories
          .filter((candidate) => path.basename(candidate).toLowerCase() === entry.id.toLowerCase());
        if (matches.length === 1) sourcePath = path.relative(checkout.root, matches[0] ?? '').split(path.sep).join('/');
        else if (matches.length === 0 && directories.includes(checkout.root)) sourcePath = '.';
        if (!sourcePath) throw new Error(`${entry.id}: expected one exact upstream skill directory, found ${matches.length}`);
      }
      if (sourcePath.split('/').some((part) => part === '..')) throw new Error(`${entry.id}: source path traversal is forbidden`);
      if (sourcePath === '.' && !override?.allowFiles?.length) throw new Error(`${entry.id}: repository-root scope is forbidden; configure a narrow skill subdirectory or explicit audited file allowlist`);
      await materializeSparse(checkout.root, checkout.commit, checkout.paths, sourcePath);
      const sourceRoot = path.resolve(checkout.root, sourcePath);
      if (!sourceRoot.startsWith(`${checkout.root}${path.sep}`) && sourceRoot !== checkout.root) throw new Error(`${entry.id}: source escapes checkout`);
      const bodyFile = override?.bodyFile ?? 'SKILL.md';
      const bodyPath = path.join(sourceRoot, bodyFile);
      const bodyDocument = await readFile(bodyPath, 'utf8');
      const sourceLicenses = await directLicenseFiles(sourceRoot);
      const repoLicenses = sourceRoot === checkout.root ? [] : await directLicenseFiles(checkout.root);
      const applicableLicenses = [...sourceLicenses.map((name) => ({ root: sourceRoot, name })), ...repoLicenses.map((name) => ({ root: checkout.root, name }))];
      const stars = locked?.selection.stars ?? starsCache.get(repo) ?? await githubStars(repo);
      starsCache.set(repo, stars);
      const official = override?.official ?? locked?.selection.official ?? false;
      const evidence = (override?.evidence ?? locked?.selection.evidence ?? (
        advertised?.subpath
          ? 'The catalogue URL names this exact upstream skill directory.'
          : 'The advertised repository contains one exact case-insensitive directory-name match.'
      )).split(' Unsafe omissions:')[0] ?? '';

      if (applicableLicenses.length === 0) {
        const local = await snapshotLocal(entry.directory);
        next.skills[entry.id] = {
          source: repo, commit: checkout.commit, path: sourcePath, ...local,
          status: 'unresolved', blocker: `Upstream commit ${checkout.commit} has no applicable license or notice in ${sourcePath} or the repository root; catalogue stub left untouched.`,
          selection: { official, stars, exactName: path.basename(sourcePath).toLowerCase() === entry.id.toLowerCase(), evidence },
        };
        process.stdout.write(`unresolved ${entry.id}: unlicensed\n`);
        continue;
      }

      const staging = path.join(workspace, `stage-${entry.id}`);
      const copied = await copySafeTree(sourceRoot, staging, { allowFiles: override?.allowFiles, allowUnsafe: override?.allowUnsafe });
      for (const license of applicableLicenses) {
        let name = license.name;
        try {
          const existing = await readFile(path.join(staging, name));
          const incoming = await readFile(path.join(license.root, license.name));
          if (hash(existing) === hash(incoming)) continue;
          name = `UPSTREAM_${name}`;
        } catch { /* destination does not exist */ }
        await copyFile(path.join(license.root, license.name), path.join(staging, name));
      }
      const operational = bodyDocument.startsWith('---\n')
        ? mergeSkillDocument(entry.document, bodyDocument)
        : mergeSkillBody(entry.document, bodyDocument);
      await writeFile(path.join(staging, 'SKILL.md'), operational);
      // Preserve only baseline OpenDesign-owned tracked side files. Everything
      // else in the destination is vendor-owned and is replaced clean-room.
      const tracked = (await run('git', ['ls-files', '--', path.relative(REPO_ROOT, entry.directory)], REPO_ROOT)).split('\n').filter(Boolean);
      for (const repositoryFile of tracked) {
        const relative = path.relative(entry.directory, path.join(REPO_ROOT, repositoryFile)).split(path.sep).join('/');
        if (relative === 'SKILL.md') continue;
        const target = path.join(staging, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(REPO_ROOT, repositoryFile), target);
      }
      await rm(entry.directory, { recursive: true, force: true });
      await import('node:fs/promises').then(({ rename }) => rename(staging, entry.directory));
      const local = await snapshotLocal(entry.directory);
      const tree = await run('git', ['rev-parse', `${checkout.commit}^{tree}`], checkout.root);
      next.skills[entry.id] = {
        source: repo, commit: checkout.commit, path: sourcePath, ...local,
        vendorFiles: local.files,
        provenance: { tree, files: local.hashes ?? {}, bodyFile },
        status: 'vendored', skippedUnsafeFiles: copied.skipped,
        skippedUnsafeExceptions: copied.reasons.filter((reason) => override?.allowUnsafe?.some((allowed) => reason.startsWith(`${allowed}:`))),
        selection: { official, stars, exactName: path.basename(sourcePath).toLowerCase() === entry.id.toLowerCase(), evidence: `${evidence}${copied.reasons.length ? ` Unsafe omissions: ${copied.reasons.join('; ')}` : ''}` },
      };
      process.stdout.write(`vendored ${entry.id}: ${local.files.length} files, ${local.bytes} bytes, ${copied.skipped} unsafe skipped\n`);
    }

    await writeFile(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

await main();
