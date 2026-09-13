# Development Notes

This package is a Host-only Cordis plugin. It wraps the global `llm/stream`
waterfall and merges consecutive reasoning blocks before the Agent Loop records
or assembles them. There is intentionally no browser bundle and no user-facing
README in this initial implementation.

## Repository layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Host stream transformer and Cordis entry point |
| `lib/index.js` and `lib/types/` | Precompiled Route A distribution artifacts |
| `test/index.test.mjs` | Pure, assembler, lifecycle, and plugin contract tests |
| `cordis.patch.yml` | Bundle patch that inserts the Host plugin row |
| `.profile-before-web/` | Local-only before-image for the authorized web-profile mount |

## Local development

```powershell
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
```

The `test` script builds before executing `node --test`, so tests always run the
same compiled artifacts that a git installation receives. Do not add a
`prepare` script. The `lib/` output and its declarations must be committed with
source changes.

## Stream policy

Each `llm/stream` call has independent state. The transformer merges only
consecutive reasoning sources, uses two line breaks between non-empty sources,
and keeps text, tool-call, usage, finish reason, and request boundaries intact.
A synthetic reasoning block end is emitted before every non-reasoning boundary.
When merging changes the block count, `finish.replayState.response` is retained
and the opaque block-aligned `replayState.blocks` field is removed.

The transformer also synthesizes a reasoning start for delta-only or
block-end-only reasoning so the result satisfies the installed LLM stream
invariant. A delta arriving after its source index has been closed is ignored,
matching `BlockAssembler` behavior.

## Development mount

The active web profile can load this checkout through a profile-local junction:

```powershell
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\\profiles\\web\\node_modules\\@zhourenke\\dsh-reasoning-merge" `
  -Target "C:\\path\\to\\dsh-reasoning-merge"
```

The profile `package.json` must also list
`@zhourenke/dsh-reasoning-merge` in `dsh.profile.bundles`. The bundle row is
provided by this package's `cordis.patch.yml`; no profile patch row is needed.
Building the checkout does not reload an already-running DSH process. Restart
DSH manually after the mount or after host code changes.

The profile before-image used for the mount is intentionally ignored by git and
must remain available until the profile files, junction target, and final hashes
have been checked.
