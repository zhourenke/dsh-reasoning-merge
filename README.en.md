**English** | [中文](README.md)

# @zhourenke/dsh-reasoning-merge

**Merges the consecutive reasoning segments of one model response into a single one, so the UI shows one thinking region instead of several.**

DSH renders a response by the content blocks the provider returns: when one response is split into several consecutive reasoning blocks, the UI lists several thinking regions in a row. This plugin steps into that host-side stream and joins **adjacent reasoning blocks of the same response** into one (a blank line is inserted between the joined segments), while text, tool calls, usage, and finish reasons pass through untouched. There is no configuration and no UI control; it works as soon as it is loaded.

## What it solves

- **Several thinking regions in a row for one response**: when the provider splits its reasoning into several blocks, the UI shows them one after another; this plugin joins them into one.
- **Nothing is lost**: only the block division changes; no reasoning text is added or removed.
- **Nothing else is touched**: visible text, tool-call arguments, usage, and finish reasons are unaffected.

## Installation

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-merge"
```

**Restart DSH** after installing.

Uninstall:

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-merge
```

## Scope

This plugin joins only **adjacent reasoning segments within one model response** — one response corresponds to one model call, and only adjacent segments are joined. When visible text or a tool call appears in between, the current segment ends there and any reasoning that follows is a new segment; the same holds for a new response after a tool call. Merging changes nothing about the content: no reasoning text is added or removed, a blank line is inserted between the former segments, and text, tool calls, usage, and finish reasons pass through untouched.

## Compatibility

Tested with **DSH v0.1.5-rc.1** (2026-09).

## License

MIT