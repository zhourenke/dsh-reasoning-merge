# Development Notes

This package is a Host-only Cordis plugin. It wraps the global `llm/stream`
waterfall and merges consecutive reasoning blocks before the Agent Loop records
or assembles them. There is intentionally no browser bundle.

`README.md` / `README.en.md` are the user-facing interface and carry only what a
user needs to install the plugin and confirm it works. This file carries the
maintainer-facing mechanism, the exact merge policy, and the statements the
README makes that must stay true.

## Repository layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Host stream transformer and Cordis entry point |
| `lib/index.js` and `lib/types/` | Precompiled Route A distribution artifacts |
| `test/index.test.mjs` | Pure, assembler, lifecycle, and plugin contract tests |
| `cordis.patch.yml` | Bundle patch that inserts the Host plugin row |
| `README.md` / `README.en.md` | User-facing install and verification guide (auto-included in the package payload) |
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

## User-visible contract

The README promises the following; each promise is backed by the policy above
and must be re-checked whenever either the transformer or the README changes.

| README statement | Backing behavior |
|---|---|
| One thinking region per response | Adjacent reasoning sources become one block that keeps the first source's index. |
| Former segments joined in order, separated by a blank line | Two line breaks are inserted between non-empty sources; whitespace-only sources contribute no separator. |
| Merging happens within one response only | Normalizer state is created per `llm/stream` call and never crosses calls. |
| Reasoning separated by text or a tool call is not merged | A non-reasoning chunk closes the current group with a synthetic block end; the next reasoning block starts a new group. |
| Text, tool calls, usage, and finish reasons are unchanged | Every non-reasoning chunk is forwarded as received; only merged groups get rewritten indices. |
| Only new responses are affected | The transformer rewrites the live stream only; durable records already written are never revisited. |
| Install and uninstall require a restart | Bundle layers are snapshotted at process start, and this plugin is a bundle-layer row. |
| No configuration, no off switch | The plugin declares no config and no settings section; disabling means uninstalling. |

Verify the record-level claim on a live session (decompress
`session.v3.jsonl.zstd` first; the expected result is only `1` and `0`, never
`2` or more):

```powershell
Get-Content <session.v3.jsonl> -Encoding utf8 -Tail 2000 |
  ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
  Where-Object { $_ -and $_.type -eq 'assistant/message' } |
  ForEach-Object { @($_.data.message.content | Where-Object { $_.type -eq 'reasoning' }).Count } |
  Group-Object | Select-Object Name, Count
```

## Development mount

The active web profile can load this checkout through a profile-local junction:

```powershell
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\web\node_modules\@zhourenke\dsh-reasoning-merge" `
  -Target "C:\path\to\dsh-reasoning-merge"
```

The profile `package.json` must also list
`@zhourenke/dsh-reasoning-merge` in `dsh.profile.bundles`. The bundle row is
provided by this package's `cordis.patch.yml`; no profile patch row is needed.
Building the checkout does not reload an already-running DSH process. Restart
DSH manually after the mount or after host code changes.

The profile before-image used for the mount is intentionally ignored by git and
must remain available until the profile files, junction target, and final hashes
have been checked.
