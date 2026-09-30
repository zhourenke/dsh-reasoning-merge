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

Verified against **DSH v0.2.0-rc.2** and Cordis **4.0.4**. Re-run the release
guide's 「DSH 升级后的复核」 after every Host upgrade; the checks that matter for
this plugin are the `llm/stream` waterfall signature, the `StreamChunk`
grammar, the exported host symbols, the admission gate, and the display
metadata read.

The transform is not a Host feature. Checked against the shipped packages:

| Host mechanism | Keyed by | Why it does not merge |
|---|---|---|
| `BlockAssembler` (`dsh-llm`) | stream `index` | One partial per index; adjacent reasoning indexes stay two blocks. |
| `AssistantStreamAccumulator` / `assembleAssistantStream` (`dsh-llm`) | stream `index` | Packs consecutive deltas of one index into a run; never joins two indexes. |
| `joinAssistantStreamText` (`dsh-llm`, new in 0.2.0) | — | Joins text-delta fragments only, and its own contract excludes reasoning fragments. |
| Live chat block state (`dsh-client-ui-chat`) | `chunk.index` | `blocks[chunk.index]`; two indexes remain two rendered regions. Consecutive `image` blocks are the only kind the renderer groups, and that grouping feeds one multi-image call rather than one block. |
| pi-ai responses stream (`@earendil-works/pi-ai`) | `event.output_index` | Each reasoning output item gets its own slot, which is what splits one response into several reasoning blocks in the first place. |

Two neighbours on the same waterfall are worth recognising, because they are
easy to mistake for this transform. `dsh-session-checkpoint-policy` (new in
0.2.0) also subscribes to `llm/stream`, but it only awaits the session flush
before the first chunk and passes every chunk through untouched.
`dsh-llm/invariant` enforces the chunk grammar — the same grammar this
transform already satisfies by synthesizing a start for delta-only sources and
an end before every non-reasoning boundary.

No shipped DSH package merges adjacent reasoning blocks, and the version this
plugin pins is the version it was verified against.

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

## User-visible contract

The transformer's user-visible behavior contract; the README states a
trimmed subset of it. Each row is backed by the policy above and must stay
true whenever either the transformer or the README changes.

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
| Removable at any time; new responses then return to the original division | The transformer runs only while its bundle row is composed. Removing the row through a dependency install stops loading at the next start, so the live stream is no longer rewritten. Durable records are never rewritten: removal does not un-merge history. |

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

## Removal

Removal behaves differently depending on the install form (measured on
DSH v0.1.5-rc.1, 2026-09, in a throwaway profile; not re-measured on
0.1.7-rc.2 — this path is package-manager and profile bookkeeping rather than
Host behavior):

| Install form | `dsh plugin remove` | Result |
|---|---|---|
| Dependency install (`dsh plugin add`, incl. `link:`) | exit 0 | The `dependencies` entry and the `dsh.profile.bundles` row are both removed; the composed config afterwards has no `dsh-reasoning-merge` row, so the next start does not load the plugin and new responses restore the original block division. An orphaned junction may remain in `node_modules` and is harmless. |
| Manual junction mount (not in `dependencies`) | exit 1 (`ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`) | Nothing is cleaned: the `bundles` row stays and the junction stays. |

A manual junction mount therefore needs the three manual steps: delete the
junction non-recursively (`[System.IO.Directory]::Delete($link, $false)`),
remove the package name from `dsh.profile.bundles` by hand, and restart DSH.
This is the reason the README scopes its uninstall command to dependency
installs and calls out the junction case.
