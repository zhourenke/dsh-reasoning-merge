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
| `icon.svg` | Plugin-list icon, read by the Host without evaluating plugin code |
| `locale/en.json` / `locale/zh.json` | Plugin-list display text, one file per language id |
| `README.md` / `README.en.md` | User-facing install and verification guide (auto-included in the package payload) |
| `.profile-before-web/` | Local-only before-image for the authorized web-profile mount |

## Host baseline

Verified against **DSH v0.2.0-rc.2** (2026-09) and **v0.2.1-rc.2** (2026-10)
under dual-baseline support, and Cordis **4.0.4** (with `~4.0.5` supported by
`^4.0.4`). Re-run the release guide's 「DSH 升级后的复核」 after every Host upgrade;
the checks that matter for this plugin are the `llm/stream` waterfall signature,
the `StreamChunk` grammar, the exported host symbols, the admission gate, and
the display metadata read.

Dual-baseline binding points:
- `peerDependencies`: `@deepseek-ai/dsh-llm` declares the dual range
  `^0.2.0-rc.2 || ^0.2.1-rc.2`, keeping both host generations in the supported
  window.
- `version`: stays at the lower-bound tuple `0.2.0-rc2.2` per release guide §2.11
  so existing consumers depending on `^0.2.0-rc2.1` are automatically upgraded
  without an artificial break; future migration to 0.2.1 as the lower bound will
  adopt the dot-preserved suffix `0.2.1-rc.2.1`.
- `devDependencies`: remains pinned to `0.2.0-rc.2` for baseline local builds,
  while forward compatibility and full host runtime integration against
  `0.2.1-rc.2` are verified in the isolated `_next-compat/` environment.
- Test suite: `test/index.test.mjs` contains automated assertions ensuring
  `peerDependencies` and README compatibility rows stay in 1:1 lockstep across
  all supported host baselines.

The transform is not a Host feature. Checked against the shipped packages:

| Host mechanism | Keyed by | Why it does not merge |
|---|---|---|
| `BlockAssembler` (`dsh-llm`) | stream `index` | One partial per index; adjacent reasoning indexes stay two blocks. Unchanged in 0.2.1-rc.2. |
| `AssistantStreamAccumulator` / `assembleAssistantStream` (`dsh-llm`) | stream `index` | Packs consecutive deltas of one index into a run; never joins two indexes. Unchanged in 0.2.1-rc.2. |
| `joinAssistantStreamText` (`dsh-llm`, new in 0.2.0) | — | Joins text-delta fragments only, and its own contract excludes reasoning fragments. |
| Live chat block state (`dsh-client-ui-chat`) | `chunk.index` | `blocks[chunk.index]`; two indexes remain two rendered regions. Consecutive `image` blocks are the only kind the renderer groups, and that grouping feeds one multi-image call rather than one block. |
| pi-ai responses stream (`@earendil-works/pi-ai`) | `event.output_index` | Each reasoning output item gets its own slot, which is what splits one response into several reasoning blocks in the first place. |

Two neighbours on the same waterfall are worth recognising, because they are
easy to mistake for this transform. `dsh-session-checkpoint-policy` (new in
0.2.0) also subscribes to `llm/stream`, but it only awaits the session flush
before the first chunk and passes every chunk through untouched.
In 0.2.0, `dsh-llm/invariant` enforced the chunk grammar; in 0.2.1 that internal
companion was removed, but the LLM stream grammar contract itself remains
identical — the same grammar this transform satisfies by synthesizing a start for
delta-only sources, an end before every non-reasoning boundary, and draining
open blocks at EOF.

No shipped DSH package merges adjacent reasoning blocks, and the versions this
plugin declares are the versions it was verified against.

## Shell baseline

The shell commands in this repository were re-checked on **pwsh 7.6.6** (2026-10)
when this environment moved off Windows PowerShell 5.1, which is still installed
and still on `PATH`. None of them needed a change for the move, because none uses
version-dependent syntax — but each one records below what it was measured on, so
the next shell change is a re-check rather than a guess:

| Command (where it appears) | Measured on pwsh 7.6.6 |
|---|---|
| `pnpm install` / `run typecheck` / `run build` / `test` (here) | run as written; the verdict is `$LASTEXITCODE`, and a successful `pnpm run` still writes its script echo to stderr, so stderr output is not a failure signal |
| `dsh plugin --profile web add` / `remove` (README pair) | the unquoted `@zhourenke/dsh-reasoning-merge` argument reaches the command verbatim, so it needs no quoting |
| The session-record pipeline (「User-visible contract」) | counts reasoning blocks per message correctly and skips unparseable lines |
| `New-Item -ItemType Junction` (「Development mount」) | creates the junction; the target is readable through it |
| `[System.IO.Directory]::Delete($link, $false)` (「Removal」) | removes the junction and leaves the target intact |

`$PSVersionTable.PSEdition` tells the two shells apart: `Core` is pwsh, `Desktop`
is 5.1. Version-dependent PowerShell behavior is documented once, in the release
guide's 「PowerShell 版本基线」; do not restate it here.

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
and the opaque block-aligned `replayState.blocks` field is removed. That drop is
the one the Host contract sanctions: `ReplayEnvelope.blocks` carries one entry
per emitted block, and assembly discards the whole envelope when that length no
longer matches the emitted block count — so keeping it after a merge would cost
the response-level half too. The options object is only read; a loop-built
request arrives deep-frozen and is never rewritten.

The transformer also synthesizes a reasoning start for delta-only or
block-end-only reasoning so the result satisfies the installed LLM stream
invariant. A delta arriving after its source index has been closed is ignored,
matching `BlockAssembler` behavior.

A group is held open until a non-reasoning chunk proves the reasoning has
ended, so the end of the input has to close it too: both entry points drain the
normalizer after their last chunk, and the streaming wrapper does it when the
provider stream reports done. That covers a provider that stops without a
terminal `finish` — the parity a truncated stream would otherwise lose, since
the block end it was holding is the one the grammar needs. No `finish` chunk is
ever synthesized: that terminal event belongs to the provider, and inventing one
would also mean inventing a `reason`. For every well-formed provider stream the
drain is a no-op, because `finish` already closed the group.

## Stream state invariants

The transformer is a small state machine, and three invariants hold it together.
They are what let it merge while streaming instead of buffering, and the code
relies on them rather than re-checking them at every step:

- **A group keeps its first source's index.** Emitted chunks are rewritten to
  `group.mergedIndex`, fixed when the group opens and never changed. That is why
  sources can be emitted live as they arrive: only the sources after the first
  need an index rewrite, and whether to merge is known the moment one starts.
- **An outstanding separator is the only text ever held back.** `pendingText` is
  written in a single place — the first delta of a source that joined a
  non-empty group — and cleared whenever it is flushed, so nothing stays trapped
  once a source has emitted.
- **A source is `closed` exactly when its index is already in
  `closedIndexes`.** Both are set together in `closeCurrent` and neither is
  undone, and a source is only ever created for an index not yet there. "The
  active source has ended" and "this index already produced a block" are then the
  same question at two scopes, which is why a repeated start, delta, or
  block-end for a closed index drops uniformly.

A source that never ended is closed when the next block arrives rather than
merged into it, so a provider that restarts a block without ending the previous
one gets two blocks and no text is spliced across a boundary the provider drew.

## User-visible contract

The transformer's user-visible behavior contract; the README states a
trimmed subset of it. Each row is backed by the policy above and must stay
true whenever either the transformer or the README changes.

| README statement | Backing behavior |
|---|---|
| One thinking region per response | Adjacent reasoning sources become one block that keeps the first source's index. |
| Former segments joined in order, separated by a blank line | Two line breaks are inserted between non-empty sources; whitespace-only sources contribute no separator. |
| Merging happens within one response only | Normalizer state is created per `llm/stream` call and never crosses calls. |
| Reasoning separated by text or a tool call is not merged | A non-reasoning chunk closes the current group with a synthetic block end, and so does the end of the input; the next reasoning block starts a new group. |
| Text, tool calls, usage, and finish reasons are unchanged | Every non-reasoning chunk is forwarded as received; only merged groups get rewritten indices. |
| Only new responses are affected | The transformer rewrites the live stream only; durable records already written are never revisited. |
| Install and uninstall require a restart | Bundle layers are snapshotted at process start, and this plugin is a bundle-layer row. |
| No configuration, no off switch | The plugin declares no config and no settings section; disabling means uninstalling. |
| Removable at any time; new responses then return to the original division | The transformer runs only while its bundle row is composed. Removing the row through a dependency install stops loading at the next start, so the live stream is no longer rewritten. Durable records are never rewritten: removal does not un-merge history. |

Verify the record-level claim on a live session. Sessions are stored compressed
as `session.v3.jsonl.zstd`, under
`$env:DSH_HOME\sessions\<workspace>\<session-id>\`, and this machine has no
`zstd` reader (`7z` is what is available), so extract one first. The expected
result is only `1` and `0`, never `2` or more:

```powershell
$dir = Join-Path $env:TEMP 'dsh-session'
7z e '<session dir>\session.v3.jsonl.zstd' "-o$dir" -y | Out-Null
$log = Join-Path $dir 'session.v3.jsonl'

Get-Content $log -Encoding utf8 -Tail 2000 |
  ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
  Where-Object { $_ -and $_.type -eq 'assistant/message' } |
  ForEach-Object { @($_.data.message.content | Where-Object { $_.type -eq 'reasoning' }).Count } |
  Group-Object | Sort-Object Name | Select-Object Name, Count
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

## Removal

Removal behaves differently depending on the install form (measured on
DSH v0.1.5-rc.1, 2026-09, in a throwaway profile; this path is package-manager
and profile bookkeeping rather than Host behavior, and it has not been
re-measured since — the current baseline is v0.2.0-rc.2):

| Install form | `dsh plugin remove` | Result |
|---|---|---|
| Dependency install (`dsh plugin add`, incl. `link:`) | exit 0 | The `dependencies` entry and the `dsh.profile.bundles` row are both removed; the composed config afterwards has no `dsh-reasoning-merge` row, so the next start does not load the plugin and new responses restore the original block division. An orphaned junction may remain in `node_modules` and is harmless. |
| Manual junction mount (not in `dependencies`) | exit 1 (`ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`) | Nothing is cleaned: the `bundles` row stays and the junction stays. |

A manual junction mount therefore needs three manual steps. First delete the
junction itself, naming it by absolute path: `Directory::Delete` resolves a
relative path against the .NET current directory, which `Set-Location` does not
move (measured on 7.6.6, same as 5.1).

```powershell
$link = "$env:DSH_HOME\profiles\web\node_modules\@zhourenke\dsh-reasoning-merge"
[System.IO.Directory]::Delete($link, $false)
```

Then remove the package name from `dsh.profile.bundles` by hand and restart DSH.
`Directory::Delete` is kept over `Remove-Item` because it says "the link, not the
target" at the API level instead of relying on how `Remove-Item` treats a reparse
point — a difference that is not about the shell, and whose measurement lives in
the release guide's 「改动运行中配置要留还原证据」.

The README gives the uninstall command for the dependency-install form only. A
junction mount is not an install form the README offers — it is the development
mount described above, which the reader reaches from this file with the checkout
in hand — so its three manual steps live here and not in the README.
