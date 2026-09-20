# gpt2human

这是一个基于 [pi](https://github.com/earendil-works/pi) 的扩展插件。它的核心功能是：**调用成本较低的模型，将主模型生成的 AI 腔回答重写为自然流畅的人话。**

像 `gpt-5.6-sol` 这样的模型虽然推理能力出众，但输出文风往往带有浓厚的“硅基生物”味——充斥着 "let's dive into"、"robust"、"leverage" 等套话和难懂的专业黑话。gpt2human 会在主模型回答结束后，在后台静默调用你指定的润色模型（例如 `deepseek/deepseek-flash`）对文本进行重写，并且**仅替换屏幕上的显示内容**。

## 核心设计：只改显示，不污染上下文

重写的结果只作用于 Markdown 渲染层。Session 中保存的、以及后续发送给 LLM 的上下文消息，**始终是主模型的原始输出**。

这一点至关重要：如果将润色后的文本写回上下文，后续的追问就会基于这段被“美化”过的文本进行，极易导致代码、命令或文件路径被意外篡改。使用 gpt2human，**你看到的是通俗易懂的人话，而模型看到的依然是精准的原话**。

💡 **快捷键：** 你可以随时按下 `Ctrl+Shift+R`，在原文和重写版之间无缝切换。

## 安装指南

全局安装：

```bash
pi install git:github.com/jay201368/gpt2human
```

若只想在当前项目中局部使用，请添加 `-l` 参数：

```bash
pi install git:github.com/jay201368/gpt2human -l
```

**初始状态与认证：**
安装完成后，插件默认开启，并默认使用 `deepseek/deepseek-flash` 进行重写。请确保你已经为该 Provider 配置了 API 认证（可通过 `pi auth` 检查）。若未配置，扩展会在首次提示“未配置认证”后，静默跳过后续的重写步骤。

## 使用方法与配置

本插件开箱即用，几乎不需要配置。若需个性化调整，支持以下交互命令：

```text
/gpt2human                                 # 查看当前配置
/gpt2human on | off                        # 开启 / 关闭插件
/gpt2human model deepseek/deepseek-flash   # 切换重写模型
/gpt2human style concise                   # 切换风格预设
/gpt2human styles                          # 列出所有预设
/gpt2human custom                          # 打开编辑器编写自定义 Prompt
```

*注：配置保存在 `~/.pi/agent/gpt2human.json`，手动修改文件同样即时生效。*

## 风格预设 (Styles)

| 预设名称 | 行为说明 |
| --- | --- |
| `humanize` | **(默认)** 消除 AI 腔和术语堆砌，让表达更自然。若输出为中文，首次出现的英文术语会附带中文解释。 |
| `concise` | 删减冗余信息，优先使用短句和列表（bullet points）。 |
| `friendly` | 语气更轻松亲切，同时保持专业度。 |
| `technical` | 仅理顺句子结构，严格保留术语的精准度。 |
| `structured` | 结构化输出，拆分为清晰的标题、简短段落和列表。 |
| `custom` | 使用你自定义的 Prompt。 |

**通用规则：** 所有预设都已在底层被要求：**严格保持事实、数字、代码、命令和文件路径原样不动**，并且跟随输入语言（即中文进中文出）。

**关于自定义提示词 (`custom`)：**
支持两种书写方式：
1. **带占位符**：如果文本中包含 `{{text}}`，它会被自动替换为原文，并将整段内容作为 User Message 发出。
2. **不带占位符**：如果你没写 `{{text}}`，你编写的内容将自动作为 System Prompt，原文则作为 User Message 发出。

## 触发条件与限制

为了不拖慢 Agent 循环，也避免在流式输出时引发屏幕闪烁，gpt2human 在以下场景会**跳过**重写逻辑：

- **非 TUI 模式**：例如使用了 `--print` 参数，或输出 json、rpc 格式时。
- **中间步骤**：当前对话轮次中带有 Tool Call 时（插件只重写最终的总结性答复）。
- **文本过短**：原文字数少于 `minLength`（默认 30 个字符，避免对“好的”这种极短回复发起多余请求）。
- **已重写过的文本**：重写结果会缓存在 session 中，重新打开会话时无需重复计算。

*注：`minLength` 目前只能通过直接修改配置文件来调整，暂无对应的斜杠命令。*

## 依赖项

本插件为 Peer Dependency，依赖宿主 `pi` 提供以下核心包：
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`

## 许可证 (License)

MIT