import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSafeSourceTree,
  mergeSkillDocument,
  parseGitHubSource,
  rankSourceCandidates,
  validateLockManifest,
  verifyVendoredSkills,
  type AdvertisedSkillsLock,
} from '../../../scripts/advertised-skills-lib.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function lock(skills: AdvertisedSkillsLock['skills']): AdvertisedSkillsLock {
  return { version: 1, skills };
}

describe('advertised skill source resolution', () => {
  it('[P1] parses repository, tree, blob, branch, and exact subpath URLs', () => {
    expect(parseGitHubSource('https://github.com/openai/skills')).toEqual({
      owner: 'openai', repo: 'skills', ref: undefined, subpath: undefined,
    });
    expect(parseGitHubSource('https://github.com/anthropics/skills/tree/main/skills/docx')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: 'main', subpath: 'skills/docx',
    });
    expect(parseGitHubSource('https://github.com/acme/catalog/tree/feature%2Fv2/skills/poster')).toEqual({
      owner: 'acme', repo: 'catalog', ref: 'feature/v2', subpath: 'skills/poster',
    });
    expect(parseGitHubSource('https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md')).toEqual({
      owner: 'vercel-labs', repo: 'agent-browser', ref: 'main', subpath: 'skills/agent-browser',
    });
    expect(() => parseGitHubSource('https://gitlab.com/acme/skills')).toThrow(/GitHub/);
    expect(() => parseGitHubSource('https://github.com/acme/skills/tree/main/../secret')).toThrow(/path traversal/);
  });

  it('[P1] ranks official publisher first, then stars, then exact skill-name match', () => {
    const ranked = rankSourceCandidates('poster', [
      { source: 'community/skill-a', official: false, stars: 9000, skillName: 'poster' },
      { source: 'official/skill-b', official: true, stars: 10, skillName: 'different' },
      { source: 'official/skill-c', official: true, stars: 8, skillName: 'poster' },
    ]);
    expect(ranked.map((candidate) => candidate.source)).toEqual([
      'official/skill-b',
      'official/skill-c',
      'community/skill-a',
    ]);

    expect(rankSourceCandidates('poster', [
      { source: 'a', official: false, stars: 20, skillName: 'different' },
      { source: 'b', official: false, stars: 20, skillName: 'poster' },
    ])[0]?.source).toBe('b');
  });
});

describe('advertised skill lock and document contracts', () => {
  it('[P1] requires a full immutable commit SHA and one lock entry per upstream skill', () => {
    expect(() => validateLockManifest(lock({
      poster: {
        source: 'https://github.com/acme/skills',
        commit: 'main',
        path: 'skills/poster',
        files: [],
        bytes: 0,
        selection: { official: false, stars: 1, exactName: true, evidence: 'fixture' },
      },
    }), ['poster'])).toThrow(/full 40-character commit SHA/);

    expect(() => validateLockManifest(lock({}), ['poster'])).toThrow(/missing lock entry.*poster/i);
    expect(() => validateLockManifest(lock({
      poster: {
        source: 'https://github.com/acme/skills', commit: SHA, path: 'skills/poster',
        files: ['SKILL.md'], bytes: 10,
        provenance: { tree: SHA, files: {}, bodyFile: 'SKILL.md' },
        selection: { official: false, stars: 1, exactName: true, evidence: 'fixture' },
      },
      native: {
        source: 'https://github.com/acme/skills', commit: SHA, path: 'skills/native',
        files: ['SKILL.md'], bytes: 10,
        provenance: { tree: SHA, files: {}, bodyFile: 'SKILL.md' },
        selection: { official: false, stars: 1, exactName: true, evidence: 'fixture' },
      },
    }), ['poster'])).toThrow(/lock entry without od\.upstream.*native/i);
  });

  it('[P1] preserves all OpenDesign frontmatter while replacing the catalogue body and duplicate YAML', () => {
    const catalogue = `---\nname: poster\ndescription: |\n  OpenDesign summary\ntriggers:\n  - poster\nod:\n  mode: image\n  category: image-generation\n  upstream: https://github.com/acme/skills\n---\n\n# Catalogue only\nInstall upstream.\n`;
    const upstream = `---\nname: upstream-poster\ndescription: upstream summary\nlicense: MIT\n---\n\n# Operational workflow\n\nRun the renderer.\n`;
    const merged = mergeSkillDocument(catalogue, upstream);

    expect(merged.match(/^---$/gm)).toHaveLength(2);
    expect(merged).toContain('name: poster');
    expect(merged).toContain('description: |\n  OpenDesign summary');
    expect(merged).toContain('triggers:\n  - poster');
    expect(merged).toContain('category: image-generation');
    expect(merged).toContain('# Operational workflow');
    expect(merged).not.toContain('name: upstream-poster');
    expect(merged).not.toContain('Install upstream.');
  });
});

describe('advertised skill vendoring safety', () => {
  it('[P1] accepts required operational files and applicable license files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-skill-safe-'));
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'references'));
    await writeFile(path.join(root, 'SKILL.md'), '# Skill\n');
    await writeFile(path.join(root, 'scripts', 'render.py'), 'print("ok")\n');
    await writeFile(path.join(root, 'references', 'guide.md'), '# Guide\n');
    await writeFile(path.join(root, 'LICENSE'), 'MIT\n');
    const result = await assertSafeSourceTree(root);
    expect(result.files).toEqual(['LICENSE', 'SKILL.md', 'references/guide.md', 'scripts/render.py']);
    expect(result.files).toContain('LICENSE');
    expect(result.skippedUnsafeFiles).toBe(0);
  });

  it.each([
    ['.git', async (root: string) => { await mkdir(path.join(root, '.git')); await writeFile(path.join(root, '.git', 'config'), 'x'); }],
    ['node_modules', async (root: string) => { await mkdir(path.join(root, 'node_modules')); await writeFile(path.join(root, 'node_modules', 'x'), 'x'); }],
    ['cache', async (root: string) => { await mkdir(path.join(root, '__pycache__')); await writeFile(path.join(root, '__pycache__', 'x'), 'x'); }],
    ['secret', async (root: string) => writeFile(path.join(root, '.env'), 'TOKEN=x')],
    ['private key', async (root: string) => writeFile(path.join(root, 'id_rsa'), 'PRIVATE')],
    ['oversized', async (root: string) => writeFile(path.join(root, 'large.bin'), Buffer.alloc(10 * 1024 * 1024 + 1))],
    ['executable outside scripts', async (root: string) => { const target = path.join(root, 'run.sh'); await writeFile(target, '#!/bin/sh\n'); await chmod(target, 0o755); }],
    ['symlink', async (root: string) => { await writeFile(path.join(root, 'target'), 'x'); await symlink('target', path.join(root, 'link')); }],
  ])('rejects %s input', async (_label, arrange) => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-skill-unsafe-'));
    await writeFile(path.join(root, 'SKILL.md'), '# Skill\n');
    await arrange(root);
    await expect(assertSafeSourceTree(root)).rejects.toThrow();
  });
});

describe('offline advertised skill verification', () => {
  it('[P1] checks lock coverage, hashes, licenses, and frontmatter without network access', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-skill-verify-'));
    const skillRoot = path.join(root, 'skills', 'poster');
    await mkdir(skillRoot, { recursive: true });
    const skill = `---\nname: poster\ndescription: Poster\ntriggers: [poster]\nod:\n  mode: image\n  upstream: https://github.com/acme/skills\n---\n\n# Operational\n`;
    const license = 'MIT\n';
    await writeFile(path.join(skillRoot, 'SKILL.md'), skill);
    await writeFile(path.join(skillRoot, 'LICENSE'), license);
    const crypto = await import('node:crypto');
    const digest = (body: string) => crypto.createHash('sha256').update(body).digest('hex');
    const manifest = lock({
      poster: {
        source: 'https://github.com/acme/skills', commit: SHA, path: 'skills/poster', bytes: Buffer.byteLength(skill) + Buffer.byteLength(license),
        files: ['LICENSE', 'SKILL.md'],
        hashes: { LICENSE: digest(license), 'SKILL.md': digest(skill) },
        provenance: { tree: SHA, files: { LICENSE: digest(license) }, bodyFile: 'SKILL.md' },
        selection: { official: false, stars: 1, exactName: true, evidence: 'fixture' },
      },
    });
    await writeFile(path.join(root, 'advertised-skills.lock.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
    await expect(verifyVendoredSkills({ repoRoot: root })).resolves.toMatchObject({
      catalogueTotal: 1, upstreamBacked: 1, vendored: 1, unresolved: 0, native: 0, files: 2,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8')).toContain('name: poster');
    fetchSpy.mockRestore();
  });
});
