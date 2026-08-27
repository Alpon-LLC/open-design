# Advertised skill vendoring

Every `skills/*/SKILL.md` entry with `od.upstream` is covered by
`advertised-skills.lock.json`. The lock records the selected repository, exact
skill subdirectory, immutable 40-character commit SHA, objective selection
evidence, file hashes, bytes, license state, and safety omissions. Native skills
without `od.upstream` are outside this process and remain untouched.

Operator-excluded entries remain as their original catalogue stubs and are
recorded as `excluded` in the lock. This deployment excludes `imagen`,
`slack-gif-creator`, and `remotion`; no upstream files from those skills are
installed.

## Maintainer workflow

Use Node 24 and the pnpm version pinned in `package.json`.

```bash
# Deliberately resolve current upstream heads and rewrite the lock/content.
pnpm skills:sync-advertised -- --update-lock

# Re-materialize the already pinned lock without advancing sources.
pnpm skills:sync-advertised

# Offline: no GitHub or other network access.
pnpm skills:verify-advertised
```

Runtime, daemon startup, packaged builds, and image builds never invoke the sync
command and never fetch skill content. Only the explicit maintainer command uses
the network. Verification reads local files and the lock only.

## Selection and content policy

Exact catalogue subpaths win. For ambiguous repository roots, selection order
is official publisher, GitHub stars, exact skill-name match, then stable lexical
order. Moved or deleted sources use an explicit evidence-bearing override. A
monorepo selection always names the relevant skill directory; intentional
multi-skill packs use their upstream router plus the complete required pack.

OpenDesign owns the local YAML frontmatter (`name`, `description`, `triggers`,
and all `od` metadata). Sync replaces only the catalogue body with upstream
operational instructions, then copies required references, scripts, templates,
assets, and applicable license/notice files without adding a second YAML block.

Symlinks, traversal, `.git`, `.github`, dependency/vendor environments, caches,
secret-like files, executables outside `scripts/`, generated build directories,
and files larger than 10 MiB are never copied. The lock records every skipped
unsafe input. Generic safety validation rejects these inputs; the sync omits
them from the materialized tree and the offline verifier rejects any such file
introduced afterward.

An upstream with no applicable license or notice is pinned and marked
`unresolved`; its existing catalogue entry is left untouched. This is the only
current unresolved class. The concrete repository, commit, subpath, and blocker
are recorded per entry in the lock so a later license grant can be audited and
vendored by rerunning the maintainer command.
