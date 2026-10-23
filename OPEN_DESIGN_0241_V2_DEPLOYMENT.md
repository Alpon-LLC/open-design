# OpenDesign 0.24.1 / OpenCode V2.0.16 deployment

Deployed on 2026-09-25.

## Runtime

- OpenDesign source baseline: upstream `open-design-v0.24.1` merged with the Alpon fork.
- OpenDesign reports package version `0.23.1`; that is the version committed in upstream tag `open-design-v0.24.1`.
- Container image: `alpon/open-design:0.24.1-v2.0.16-20260925`.
- OpenCode: `@opencode/cli-linux-x64@2.0.16` in the persistent OpenDesign data directory.
- Adapter changes follow the OpenCode V2 direction discussed in nexu-io/open-design#8313 / PR #8312.

## Compatibility wrapper

`opencode-v2-wrapper.cjs` provides the remaining deployment compatibility layer:

- maps Alpon display aliases to the 9Router `cx/*` model IDs;
- injects `--standalone --auto` for headless `run` calls;
- preserves model variants through V2's `provider/model#variant` syntax;
- translates legacy `export <session>` into `session export --standalone <session>`;
- translates OpenDesign's V1 inline MCP and external-directory configuration to V2;
- emits the live Alpon model catalogue with low/medium/high variants.

## Rollback

The consistent pre-upgrade backup is:

`/srv/alpon/backups/open-design-pre-0241-v2-20260925T0450Z`

It contains the data directory, OpenDesign home, runtime patches, and both Compose files. The prior production image remains `ghcr.io/alpon-llc/open-design:v0.3.4`.

## Validation performed

- OpenDesign TypeScript check and production web build.
- 143 targeted tests passed.
- Container health and authenticated API health checks.
- OpenCode model discovery and connection smoke test.
- Exact external Alpon logo read that previously failed.
- New V2 session continuation.
- Export of a pre-upgrade beta session.
- Both configured MCP servers connected.
