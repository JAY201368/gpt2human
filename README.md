# gpt2human

一个 [pi](https://pi.dev) 扩展:自动把模型的最终回答改写成**清晰、像人话的输出**——只改显示、不改上下文。

> 场景:你主用 `gpt-5.6-sol` 这类能力很强但输出"硅基味"很重的模型;再配一台便宜、会表达的小模型(如 `deepseek/deepseek-flash`)专门负责把最终回答"润"成人话。gpt2human 就是把这个流程自动化的插件。

---

## 功能特色

- 🔌 **独立配置 refine 模型**:润色模型与主对话模型完全解耦,可随时切换。
- 🎨 **多套风格预设**:`Humanize`(默认)、`Concise`、`Friendly`、`Technical`、`Structured`,并支持**完全自定义提示词**(含 `{{text}}` 占位符)。
- ⌨️ **一键切换**:`ctrl+shift+r` 在「原文 / 润色后」之间原地切换。
- 🖥️ **纯显示层替换**:原始回答始终保留在会话与 LLM 上下文中,润色结果只用于终端渲染,不会污染后续追问,也不会改写代码/命令。
- ⚡ **智能跳过**:只润色最终回答(带工具调用的中间轮次跳过),过短的碎句(如 "ok"、"马上")不处理。
- 💾 **配置持久化**:配置保存在 `~/.pi/agent/gpt2human.json`,润色映射随会话持久化,`/reload` 后仍能恢复。

---

## 工作原理

gpt2human 监听 `message_end` 事件,在模型给出**最终回答**后,调用配置好的 refine 模型做一次改写;随后通过 pi 的 **markdown transformer** 把改写结果替换到终端显示上。因为 transformer 是纯显示层的,消息本身(原文)原封不动地保留在会话历史与 LLM 上下文里。

```
主模型回答(原文)
      │
      ▼
message_end ──► 调用 refine 模型 ──► 得到"人话版"
      │                                │
      ▼                                ▼
保留原文进上下文                markdown transformer 替换显示
```

---

## 安装

### 方式一:作为 pi 包安装(推荐,发布到 GitHub 后)

```bash
# 用 git 地址安装(替换成你自己的仓库)
pi install git:github.com/<your-name>/gpt2human@v1.0.0

# 或安装本地目录
pi install ~/Desktop/gpt2human
```

### 方式二:手动安装(不发布也能用)

把扩展文件放进 pi 的全局扩展目录(或软链接过去):

```bash
mkdir -p ~/.pi/agent/extensions/gpt2human
cp extensions/gpt2human.ts ~/.pi/agent/extensions/gpt2human/index.ts

# 或者用软链接,方便同步仓库里的更新
ln -sf ~/Desktop/gpt2human/extensions/gpt2human.ts ~/.pi/agent/extensions/gpt2human/index.ts
```

### 方式三:临时试用

```bash
pi -e ~/Desktop/gpt2human/extensions/gpt2human.ts
```

安装后,在 pi 里执行 `/reload`(或重启 pi)即可生效。

---

## 快速开始

1. 确保 refine 模型已配置好鉴权(例如 `pi auth` 或对应环境变量)。
2. 默认使用 `deepseek/deepseek-flash` 作为润色模型、`Humanize` 预设。
3. 直接对话:模型给出最终回答后,会先显示原文,片刻后自动换成"人话版"。
4. 按 `ctrl+shift+r` 随时在原文与润色版之间来回切换;底部状态栏会以灰色小字显示当前状态(`gpt2human: Refined / Original`)。

---

## 命令参考

| 命令 | 说明 |
| --- | --- |
| `/gpt2human` | 查看当前配置 |
| `/gpt2human on` / `off` | 开启 / 关闭 |
| `/gpt2human model <provider/id>` | 设置润色模型,例:`/gpt2human model deepseek/deepseek-flash` |
| `/gpt2human style <preset>` | 切换风格预设,例:`/gpt2human style concise` |
| `/gpt2human styles` | 列出所有预设 |
| `/gpt2human custom` | 在编辑器里编写自定义提示词 |

快捷键:

| 快捷键 | 说明 |
| --- | --- |
| `ctrl+shift+r` | 在「原文 / 润色后」之间切换 |

---

## 风格预设

| 预设 ID | 名称 | 效果 |
| --- | --- | --- |
| `humanize` | Humanize | 通俗、自然、像人话(默认),术语首次出现时附带简短解释 |
| `concise` | Concise | 精简、易扫读,去冗余 |
| `friendly` | Friendly | 温暖、口语化,但仍专业准确 |
| `technical` | Technical | 面向技术读者,保留术语、结构更清晰 |
| `structured` | Structured | 用标题、短段落、列表重新组织 |
| `custom` | Custom | 使用你自己的提示词 |

---

## 配置文件

配置保存在 `~/.pi/agent/gpt2human.json`:

```json
{
  "enabled": true,
  "model": "deepseek/deepseek-flash",
  "style": "humanize",
  "customPrompt": "",
  "minLength": 30
}
```

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否启用 |
| `model` | 润色模型,格式 `provider/modelId` |
| `style` | 预设 ID(`humanize` / `concise` / `friendly` / `technical` / `structured` / `custom`) |
| `customPrompt` | `style` 为 `custom` 时使用的提示词;含 `{{text}}` 时,`{{text}}` 会被替换为原文 |
| `minLength` | 少于该字符数的文本块不润色,默认 30 |

---

## 自定义提示词

`/gpt2human custom` 会打开编辑器。提示词里可以用 `{{text}}` 占位原文:

```
把下面的内容改得通俗易懂、像正常人说话。保留所有事实、数字、代码、命令和文件路径。
输出语言与输入保持一致。只输出改写后的内容。

待改写内容:
{{text}}
```

如果提示词中**不包含** `{{text}}`,则提示词会作为 system prompt,原文作为 user message 单独发送。

---

## 常见问题

**Q:为什么润色只发生在终端显示,不改上下文?**
A:这是刻意的设计。如果直接替换消息内容,后续追问会基于"改写版"而非原文,代码、命令、精确措辞可能被破坏。显示层替换既能获得可读性,又保持上下文无损。

**Q:润色模型需要单独配置鉴权吗?**
A:需要。润色模型通过 pi 的模型注册表调用,请确保该模型已配置 API key(如 `pi auth` 或对应环境变量)。未配置时插件会给出一次性警告并跳过。

**Q:为什么最终回答会有短暂的"原文 → 润色版"过渡?**
A:为了确保两种版本都能稳定显示、并在 `/reload` 后恢复,润色是在 `message_end` 阶段同步完成的。通常只需 1 秒左右。

**Q:支持哪些模型做润色?**
A:任何 pi 已配置的模型都可以,格式为 `provider/modelId`。注意模型 ID 以实际目录为准(例如 DeepSeek 的轻量模型在目录里叫 `deepseek/deepseek-flash`,而不是 `deepseek-v4-flash`)。

---

## 许可证

[MIT](./LICENSE)
