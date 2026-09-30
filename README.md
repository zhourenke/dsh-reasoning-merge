[English](README.en.md) | **中文**

# @zhourenke/dsh-reasoning-merge

**把一次模型响应里连续的多段推理合并成一段，界面上只出现一个思考区域。**

DSH 按 provider 返回的内容块渲染响应；当一次响应被拆成多段推理时，本插件把它们接成一段（段间补一个空行），其余内容原样通过。没有配置项，也没有界面控件，装好即用。

## 它解决什么问题

- **一次响应里连续出现多个思考区域**：provider 把思考过程分成多段时，界面会一段接一段地列出来；装上本插件后只剩一段。
- **只改分块，不改内容**：推理原文不增不减，文本、工具调用、用量与结束原因也不受影响。

## 安装

```powershell
dsh plugin --profile web add "github:zhourenke/dsh-reasoning-merge"
```

安装后需要**重启 DSH**。

装好后，DSH 的插件列表里会显示本插件的中文/英文名称、说明与图标，随界面语言切换。

卸载：

```powershell
dsh plugin --profile web remove @zhourenke/dsh-reasoning-merge
```

## 生效范围

合并只发生在同一次响应内相邻的两段推理之间——一次响应对应一次模型调用。推理中间一旦出现文本或工具调用，当前段就此结束，之后的推理另起一段；工具调用之后的下一次响应也是如此。

## 兼容性

在 **DSH v0.2.0-rc.2**（2026-09）下测试通过。

## 许可证

MIT