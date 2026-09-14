[English](README.en.md) | **中文**

# @zhourenke/dsh-reasoning-merge

**把一次模型响应里连续的多段推理合并成一段，界面上只出现一个思考区域。**

DSH 按 provider 返回的内容块渲染响应：同一次响应如果被切成多个连续的 reasoning 块，界面上就会连续出现多个思考区域。本插件在宿主侧介入这一层流，只把**同一次响应内相邻**的推理块接成一段（各段原文之间补一个空行），文本、工具调用、用量与结束原因全部原样通过。没有配置项，也没有界面控件，装好即用。

## 它解决什么问题

- **一次响应里连续出现多个思考区域**：provider 把思考过程分成多块时，界面会一段接一段地列出来；本插件把它们接成一段。
- **不丢内容**：只改变分块方式，推理原文不增不减。
- **不碰其它内容**：可见文本、工具调用参数、用量统计、结束原因都不受影响。
- **随时可卸**：作为 profile 层插入，不修改 DSH 本体；卸载并重启后恢复原有分块。

## 前置条件

纯宿主侧插件，不需要浏览器半边，也不需要额外的外部程序或依赖。

确认插件已在 profile 清单里：

```powershell
$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = "$env:USERPROFILE\.dsh" }
Select-String -Path "$dshHome\profiles\web\package.json" -Pattern 'dsh-reasoning-merge' -SimpleMatch
```

预期至少命中 `dsh.profile.bundles` 里的那一行。命中条数取决于安装形态：用 `dsh plugin add` 正式安装时 `dependencies` 与 `dsh.profile.bundles` 各一条；手工连接点挂载时只在 `dsh.profile.bundles` 里有一条。

## 安装

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-merge"
```

安装后需要**重启 DSH**。本插件没有界面控件，不需要刷新页面。

卸载：

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-merge
```

卸载后同样需要重启 DSH。

## 怎么确认它在工作

看界面：在一次包含多段连续推理的响应里，**思考区域只出现一个**，原本分开的几段按顺序接在一起、段间空一行。

这句话带前置状态：如果这次响应本来就只有一段推理，界面与装插件之前完全一样——**这不代表插件没生效**。要挑一次"以前会连出好几个思考区域"的响应来对照。

需要核对原始记录时，会话以 zstd 压缩存放在 `$env:DSH_HOME\sessions\<工作区>\session-<id>\session.v3.jsonl.zstd`；解压后看该响应的 `assistant/message`，`content` 里只有一个 `reasoning` 块，其后才是 `text` 或 `tool-call`。

## 生效范围

- **只在同一次模型响应内合并**：一次响应对应一次模型调用，只有相邻的推理段才会接成一段。
- **被文本或工具调用隔开的推理不合并**：中间出现可见文本或工具调用时，当前这段推理到此结束；其后出现的推理是新的一段（工具调用之后的那次新响应也是新的一段）。
- **不跨响应合并**：两次不同的模型调用各自独立，互不影响。
- **不改变内容**：推理原文不增删，只在原本分开的段之间插入一个空行；文本、工具调用、用量、结束原因原样通过。
- **没有开关**：本插件不提供配置项，停用方式就是卸载。

## 已知限制（实测确认）

- **只影响加载之后的新响应**：已经落盘的会话记录保持原样，不会被追溯合并。
- **provider 不分块时看不到变化**：一次响应只发一段推理时，合并前后完全一致。
- **只处理推理块的分块方式**：不做摘要、删减或重写，推理原文一字不改。

## 兼容性

在 **DSH v0.1.5-rc.1**（2026-09）下测试通过。

## 许可证

MIT
