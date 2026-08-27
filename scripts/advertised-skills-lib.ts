import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface GitHubSource {
  owner: string;
  repo: string;
  ref: string | undefined;
  subpath: string | undefined;
}

export interface SourceCandidate {
  source: string;
  official: boolean;
  stars: number;
  skillName: string;
}

export interface LockedSkill {
  source: string;
  commit: string;
  path: string;
  files: string[];
  bytes: number;
  hashes?: Record<string, string>;
  vendorFiles?: string[];
  provenance?: { tree: string; files: Record<string, string>; bodyFile: string };
  licenseFiles?: string[];
  status?: 'vendored' | 'unresolved' | 'excluded';
  blocker?: string;
  skippedUnsafeFiles?: number;
  skippedUnsafeExceptions?: string[];
  selection: {
    official: boolean;
    stars: number;
    exactName: boolean;
    evidence: string;
  };
}

export interface AdvertisedSkillsLock {
  version: 1;
  generatedAt?: string;
  skills: Record<string, LockedSkill>;
}

export interface VerificationSummary {
  catalogueTotal: number;
  upstreamBacked: number;
  vendored: number;
  unresolved: number;
  excluded: number;
  native: number;
  files: number;
  bytes: number;
  skippedUnsafeFiles: number;
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_PARTS = new Set([
  '.git', '.github', 'node_modules', 'venv', '.venv', '__pycache__',
  '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'dist', 'build',
]);
const SECRET_NAMES = /^(?:\.env(?:\..*)?|auth(?:\.json)?|credentials?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;
const LICENSE_NAMES = /^(?:licen[cs]e|copying|notice|copyright)(?:\..*)?$/i;

function normalizeRelative(input: string): string {
  const decoded = decodeURIComponent(input).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!decoded || decoded.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`path traversal or empty path is not allowed: ${input}`);
  }
  return decoded;
}

export function parseGitHubSource(input: string): GitHubSource {
  if (/(?:^|\/)(?:\.\.|%2e%2e)(?:\/|$)/i.test(input)) {
    throw new Error(`GitHub source contains path traversal: ${input}`);
  }
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`Only HTTPS GitHub sources are supported: ${input}`);
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) throw new Error(`Invalid GitHub repository URL: ${input}`);
  const owner = normalizeRelative(parts[0] ?? '');
  const repo = normalizeRelative((parts[1] ?? '').replace(/\.git$/, ''));
  if (parts.length === 2) return { owner, repo, ref: undefined, subpath: undefined };
  const kind = parts[2];
  if ((kind !== 'tree' && kind !== 'blob') || !parts[3]) {
    throw new Error(`Unsupported GitHub source URL: ${input}`);
  }
  const ref = normalizeRelative(parts[3]);
  let subpathParts = parts.slice(4);
  if (kind === 'blob') subpathParts = subpathParts.slice(0, -1);
  const subpath = subpathParts.length > 0 ? normalizeRelative(subpathParts.join('/')) : undefined;
  return { owner, repo, ref, subpath };
}

export function rankSourceCandidates(skillName: string, candidates: SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((left, right) =>
    Number(right.official) - Number(left.official)
    || right.stars - left.stars
    || Number(right.skillName === skillName) - Number(left.skillName === skillName)
    || left.source.localeCompare(right.source),
  );
}

export function validateLockManifest(manifest: AdvertisedSkillsLock, upstreamSkillIds: string[]): void {
  if (manifest.version !== 1) throw new Error(`Unsupported advertised skills lock version: ${manifest.version}`);
  const expected = new Set(upstreamSkillIds);
  for (const id of [...expected].sort()) {
    const entry = manifest.skills[id];
    if (!entry) throw new Error(`Missing lock entry for od.upstream skill: ${id}`);
    if (!FULL_SHA.test(entry.commit)) throw new Error(`${id} must use a full 40-character commit SHA`);
    if (!entry.path || entry.path.split('/').some((part) => part === '..')) throw new Error(`${id} has an unsafe source path`);
    if (entry.status === 'vendored' && entry.path === '.' && !entry.vendorFiles?.length) throw new Error(`${id} uses forbidden repository-root scope without an audited allowFiles list`);
    if (!entry.files.includes('SKILL.md')) throw new Error(`${id} lock entry does not include SKILL.md`);
    if ((entry.status === 'unresolved' || entry.status === 'excluded') && !entry.blocker) throw new Error(`${id} non-vendored lock entry has no concrete blocker`);
    if ((entry.skippedUnsafeFiles ?? 0) !== (entry.skippedUnsafeExceptions?.length ?? 0)) throw new Error(`${id} has unaudited unsafe omissions`);
    if (entry.status === 'vendored' && (!entry.provenance?.tree || !entry.provenance.bodyFile)) throw new Error(`${id} has no pinned Git provenance`);
  }
  for (const id of Object.keys(manifest.skills).sort()) {
    if (!expected.has(id)) throw new Error(`Lock entry without od.upstream catalogue skill: ${id}`);
  }
}

function splitFrontmatter(document: string): { frontmatter: string; body: string } {
  const normalized = document.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md must begin with YAML frontmatter');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('SKILL.md frontmatter is not terminated');
  return {
    frontmatter: normalized.slice(4, end).trimEnd(),
    body: normalized.slice(end + 5).replace(/^\s+/, '').trimEnd(),
  };
}

export function mergeSkillDocument(catalogue: string, upstream: string): string {
  const local = splitFrontmatter(catalogue);
  const remote = splitFrontmatter(upstream);
  if (!remote.body) throw new Error('Upstream SKILL.md has no operational body');
  return `---\n${local.frontmatter}\n---\n\n${remote.body}\n`.replace(/[ \t]+$/gm, '');
}

export function mergeSkillBody(catalogue: string, operationalBody: string): string {
  const local = splitFrontmatter(catalogue);
  const body = operationalBody.replaceAll('\r\n', '\n').trim();
  if (!body) throw new Error('Upstream operational document has no body');
  return `---\n${local.frontmatter}\n---\n\n${body}\n`.replace(/[ \t]+$/gm, '');
}

function validateRelativeFile(relative: string): void {
  const parts = relative.split('/');
  if (parts.some((part) => FORBIDDEN_PARTS.has(part.toLowerCase()))) {
    throw new Error(`Forbidden generated or control path: ${relative}`);
  }
  const basename = parts.at(-1) ?? '';
  if (SECRET_NAMES.test(basename)) throw new Error(`Forbidden secret-like file: ${relative}`);
}

export async function assertSafeSourceTree(root: string): Promise<{
  files: string[];
  bytes: number;
  skippedUnsafeFiles: number;
}> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Source root must be a real directory: ${root}`);
  const files: string[] = [];
  let bytes = 0;

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      validateRelativeFile(relative);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) throw new Error(`Symlinks are forbidden: ${relative}`);
      if (details.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!details.isFile()) throw new Error(`Unsupported filesystem entry: ${relative}`);
      if (details.size > MAX_FILE_BYTES) throw new Error(`File exceeds 10 MiB: ${relative}`);
      if ((details.mode & 0o111) !== 0 && !relative.startsWith('scripts/')) {
        throw new Error(`Executable is outside recognized scripts/: ${relative}`);
      }
      files.push(relative);
      bytes += details.size;
    }
  }

  await visit(root);
  files.sort();
  if (!files.includes('SKILL.md')) throw new Error('Source directory does not contain SKILL.md');
  return { files, bytes, skippedUnsafeFiles: 0 };
}

export function hasUpstreamFrontmatter(document: string): boolean {
  return /^\s{2}upstream:\s*["']?\S+/m.test(splitFrontmatter(document).frontmatter);
}

export async function verifyVendoredSkills(options: { repoRoot: string }): Promise<VerificationSummary> {
  const skillsRoot = path.join(options.repoRoot, 'skills');
  const lockPath = path.join(options.repoRoot, 'advertised-skills.lock.json');
  const manifest = JSON.parse(await readFile(lockPath, 'utf8')) as AdvertisedSkillsLock;
  const directories = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const upstreamIds: string[] = [];
  for (const id of directories) {
    const document = await readFile(path.join(skillsRoot, id, 'SKILL.md'), 'utf8');
    if (hasUpstreamFrontmatter(document)) {
      const frontmatter = splitFrontmatter(document).frontmatter;
      for (const required of ['name', 'description', 'od']) {
        if (!new RegExp(`^${required}:`, 'm').test(frontmatter)) throw new Error(`${id} lost required OpenDesign frontmatter field: ${required}`);
      }
      upstreamIds.push(id);
    }
  }
  validateLockManifest(manifest, upstreamIds);
  let files = 0;
  let bytes = 0;
  let vendored = 0;
  let unresolved = 0;
  let excluded = 0;
  let skippedUnsafeFiles = 0;
  for (const id of upstreamIds) {
    const entry = manifest.skills[id];
    if (!entry) continue;
    const safeTree = await assertSafeSourceTree(path.join(skillsRoot, id));
    if (safeTree.files.join('\n') !== [...entry.files].sort().join('\n')) throw new Error(`${id} file set differs from lock`);
    if (entry.status === 'vendored' && !entry.files.some((relative) => LICENSE_NAMES.test(path.basename(relative)))) {
      throw new Error(`${id} vendored source has no applicable license or notice`);
    }
    let measuredBytes = 0;
    for (const relative of entry.files) {
      validateRelativeFile(relative);
      const absolute = path.join(skillsRoot, id, relative);
      const details = await stat(absolute);
      if (!details.isFile()) throw new Error(`${id}/${relative} is not a regular file`);
      if (details.size > MAX_FILE_BYTES) throw new Error(`${id}/${relative} exceeds 10 MiB`);
      const body = await readFile(absolute);
      const actual = createHash('sha256').update(body).digest('hex');
      if (entry.hashes?.[relative] !== actual) throw new Error(`${id}/${relative} hash differs from lock`);
      measuredBytes += body.byteLength;
      files += 1;
    }
    if (measuredBytes !== entry.bytes) throw new Error(`${id} byte count differs from lock`);
    bytes += measuredBytes;
    skippedUnsafeFiles += entry.skippedUnsafeFiles ?? 0;
    if (entry.status === 'unresolved') unresolved += 1;
    else if (entry.status === 'excluded') excluded += 1;
    else vendored += 1;
  }
  return {
    catalogueTotal: directories.length,
    upstreamBacked: upstreamIds.length,
    vendored,
    unresolved,
    excluded,
    native: directories.length - upstreamIds.length,
    files,
    bytes,
    skippedUnsafeFiles,
  };
}
