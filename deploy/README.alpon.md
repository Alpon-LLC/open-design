# OpenDesign canonical image (Alpon)

One versioned, from-source Docker build for the self-hosted OpenDesign daemon.
Replaces the fragile hand-posed snapshot + remediation wrap + emergency
bind-mount overlay.

## What it replaces

| Old (fragile) | New (canonical) |
|---|---|
| `/srv/alpon/runtime/open-design-daemon` snapshot | built from source in `deploy/Dockerfile.alpon` |
| `/srv/alpon/build/open-design-remediation-20260829-01/Dockerfile` | remediation folded into the build stage |
| `compose.emergency.yaml` bind-mount overlay | fix baked into the image |

## Build

```bash
# from the repo root; branch that includes the 413 body-limit fix
docker build -f deploy/Dockerfile.alpon -t alpon/open-design:canonical .
docker image inspect alpon/open-design:canonical --format '{{.Id}}'   # digest to pin
```

Then point `compose.yaml` `image:` at the built image (pin by digest) and
`docker compose up -d`.

## What the image contains

- Daemon: `/opt/opendesign/runtime/daemon` (dist + node_modules + package.json).
- Web static export: `/opt/opendesign/apps/web/out` — the daemon's
  `STATIC_DIR = PROJECT_ROOT/apps/web/out` (`resolveProjectRoot` resolves the
  daemon at `dist/` up two levels to `/opt/opendesign`).
- Resources: `skills/`, `design-systems/`, `design-templates/`, `craft/`,
  `prompt-templates/`, `assets/frames/`, `assets/community-pets/`,
  `plugins/_official/`.
- The Hermes `design` agent ACP harness via `hermes-design`
  (`exec /opt/hermes/bin/hermes --profile design "$@"`) on the
  `ghcr.io/alpon-llc/hermes-agent-code:v0.1.1` base (the same published glibc
  image the Hermes gateways run). The toolchain is glibc (Debian) end-to-end,
  so the pinned node 24.18 binary copied into the runtime actually loads.
- Node pinned to 24.18.0 (`node:24.18.0-bookworm-slim` build stage); `better-sqlite3` + `node-pty` rebuilt from source (glibc); transitive CVEs patched (nanoid/postcss/protobufjs/esbuild via `npm pack` replace) and `image-size@1.2.1` (via `deploy/remediate-runtime.py`, republished as `image-size-alpon@1.2.2-alpon.1`).

## Image provenance / CI

The built OpenDesign image is pushed to `ghcr.io/<owner>/<repo>` by
`.github/workflows/container-build.yml` (builds `deploy/Dockerfile.alpon`);
`.github/workflows/auto-versioning.yml` allocates a semver on merge and
dispatches it. (Modeled on `Alpon-LLC/hermes-agent-code`.)

**The base image `ghcr.io/alpon-llc/hermes-agent-code:v0.1.1` is PRIVATE** (its
repo is private). The workflow can pull it during the build only if you do one
of:
- **Grant repo Access:** GitHub → `alpon-llc` org → Packages → `hermes-agent-code`
  → Manage Actions access → add `Alpon-LLC/open-design`. The workflow's
  `GITHUB_TOKEN` then pulls it (no workflow change).
- **PAT override:** add repo secrets `GHCR_USERNAME` + `GHCR_TOKEN` (fine-grained
  PAT with `packages: read` + `write`). `container-build.yml` prefers these over
  `GITHUB_TOKEN`.
Otherwise the build fails at the `FROM` pull with a permission error.

## What is NOT in the image

Runtime config and secrets come from the compose `env_file` at container start —
the image must not contain `OD_API_TOKEN`, `OD_DISABLE_API_AUTH`,
`OD_BIND_HOST`, `OD_ALLOWED_ORIGINS`, `OPENCODE_BIN`, or any Slack/Notion/GitHub
credentials. Only paths + `NODE_OPTIONS=--max-old-space-size=384` +
`OD_PORT/WEB_PORT/DATA_DIR` + `HERMES_BIN` are baked in.

## Verify after deploy

```bash
curl -s http://127.0.0.1:4119/api/health            # {"ok":true,"version":"..."}
python3 -c "import json;open('/tmp/b.json','w').write(json.dumps({'html':'x'*(5*1024*1024)}))"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
  --data-binary @/tmp/b.json http://127.0.0.1:4119/api/artifacts/save   # 401 (auth), NOT 413
```

## Notes

- **Toolchain change from the live setup:** the prior image was built on an
  Alpine/musl base (`alpon/hermes-agent:x509-wif-20260830-05`, a temporary GSM
  recovery build, never pushed to ghcr). This canonical build uses the
  published glibc `ghcr.io/alpon-llc/hermes-agent-code` base and a
  `node:24.18.0-bookworm-slim` build stage, so node + native addons are glibc.
  **You must run a real `docker build` to validate** (node headers for
  `npm rebuild`, the glibc native build, and that the pinned node loads on the
  Debian base). No Docker socket in the agent env — the host/CI build is the gate.
- `NODE_OPTIONS=--max-old-space-size=384` matches the live image. (The vault's
  design-agent note suggesting 1024 is stale — reconcile if HyperFrames renders
  OOM in practice.)
- To bake the 413 body-limit fix into the image, build from a branch that has
  the `apps/daemon/src/server.ts` per-route `64mb` override (see the
  `fix/artifact-save-413-body-limit` PR) or from `main` once it merges.
- The dependency hardening currently lives in the Dockerfile's post-install
  patch (proven). A cleaner future state is to move those pins into
  `pnpm-workspace.yaml` `overrides` + regenerate `pnpm-lock.yaml`.
