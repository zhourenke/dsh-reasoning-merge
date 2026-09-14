**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-merge

**Merges the consecutive reasoning segments of one model response into a single one, so the UI shows one thinking region instead of several.**

DSH renders a response by the content blocks the provider returns: when one response is split into several consecutive reasoning blocks, the UI lists several thinking regions in a row. This plugin steps into that host-side stream and joins **adjacent reasoning blocks of the same response** into one (a blank line is inserted between the joined segments), while text, tool calls, usage, and finish reasons pass through untouched. There is no configuration and no UI control; it works as soon as it is loaded.

## What it solves

- **Several thinking regions in a row for one response**: when the provider splits its reasoning into several blocks, the UI shows them one after another; this plugin joins them into one.
- **Nothing is lost**: only the block division changes; no reasoning text is added or removed.
- **Nothing else is touched**: visible text, tool-call arguments, usage, and finish reasons are unaffected.
- **Removable at any time**: it installs as a profile layer and never modifies DSH itself; after uninstalling and restarting, the original division is back.

## Prerequisites

A host-side-only plugin: no browser half, and no extra external program or dependency.

Confirm the plugin is listed in the profile manifest:

```powershell
$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = "$env:USERPROFILE\.dsh" }
Select-String -Path "$dshHome\profiles\web\package.json" -Pattern 'dsh-reasoning-merge' -SimpleMatch
```

At least the `dsh.profile.bundles` line is expected to match. How many lines match depends on the install form: a regular `dsh plugin add` install has one entry in `dependencies` and one in `dsh.profile.bundles`; a manual junction mount appears only in `dsh.profile.bundles`.

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-merge"
```

**Restart DSH** after installing. This plugin has no UI control, so no page refresh is needed.

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-merge
```

A restart is required after uninstalling as well.

## How to confirm it is working

Watch the UI: in a response that contains several consecutive reasoning segments, **only one thinking region appears**, with the former segments joined in order and separated by a blank line.

That statement has a precondition: if the response contained only one reasoning segment to begin with, the UI looks exactly as it did before the plugin was installed — **that does not mean the plugin is inactive**. Compare with a response that used to show several thinking regions in a row.

To check the raw record, sessions are stored zstd-compressed at `$env:DSH_HOME\sessions\<workspace>\session-<id>\session.v3.jsonl.zstd`; after decompression, the `assistant/message` of that response has exactly one `reasoning` block in `content`, followed by `text` or `tool-call`.

## Scope

- **Merging happens within one model response only**: one response corresponds to one model call, and only adjacent reasoning segments are joined.
- **Reasoning separated by text or a tool call is not merged**: when visible text or a tool call appears, the current reasoning segment ends there; reasoning that comes later is a new segment (a new response after a tool call is a new segment as well).
- **No merging across responses**: two different model calls stay independent of each other.
- **Content is unchanged**: no reasoning text is added or removed; a blank line is inserted between the former segments, while text, tool calls, usage, and finish reasons pass through untouched.
- **No off switch**: this plugin offers no configuration; the way to turn it off is to uninstall it.

## Known limitations (measured)

- **Only new responses are affected**: session records already on disk stay as they are and are never merged retroactively.
- **Nothing changes when the provider does not split**: if a response carries a single reasoning segment, the result is identical before and after.
- **Only the block division of reasoning is handled**: there is no summarizing, trimming, or rewriting; the reasoning text is left character for character as it was.

## Compatibility

Tested with **DSH v0.1.5-rc.1** (2026-09).

## License

MIT
