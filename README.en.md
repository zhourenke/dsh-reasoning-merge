**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-merge

**Merges the consecutive reasoning segments of one model response into a single one, so the UI shows one thinking region instead of several.**

DSH renders a response from the content blocks the provider returns; when one response is split into several reasoning segments, this plugin joins them into one (a blank line is inserted between the joined segments); everything else passes through untouched. There is no configuration and no UI control; it works as soon as it is loaded.

## What it solves

- **Several thinking regions in a row for one response**: when the provider splits its reasoning into several segments, the UI shows them one after another; with this plugin installed, only one remains.
- **Only the division changes, not the content**: no reasoning text is added or removed, and text, tool calls, usage, and finish reasons are unaffected.

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-merge"
```

**Restart DSH** after installing.

Once loaded, the DSH plugin list shows this plugin's name, description, and icon in the interface language.

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-merge
```

## Scope

Merging happens only between adjacent reasoning segments within one response — one response corresponds to one model call. When text or a tool call appears in the middle of the reasoning, the current segment ends there and what follows starts a new segment; so does the next response after a tool call.

## Compatibility

Tested with v0.2.0-rc.2 (September 2026).
Tested with v0.2.1-rc.2 (October 2026).

## License

MIT