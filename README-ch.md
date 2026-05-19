<p align="center">
  <img src="./assets/memx-architecture-zh.svg" alt="MemX 架构图" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>包含自学习、自维护和关系图记忆能力的 OpenClaw 长期记忆插件。</strong>
</p>

<p align="center">
  交流联系：<a href="mailto:neoliriven@gmail.com">neoliriven@gmail.com</a>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a> ·
  <a href="./ARCHITECTURE-ch.md">架构深读</a>
</p>

---

MemX 是一个面向 OpenClaw 的本地优先长期记忆插件。它面向真实 agent 长期工作：跨天推进
工程任务，记住项目变化，理解用户偏好，处理纠错，连接相关人物、项目、工具和文件。

**它增加的能力**：长期工作记忆、任务状态跟踪、关系召回、习惯学习、自动整理，以及紧凑的
证据注入。

## 它能做什么

### 长期记住工作上下文

MemX 会保留长对话里真正有用的信息：项目决策、用户偏好、任务状态、重要事件和原始证据。
超长输入和超长 agent 回复会被切成相互关联的片段，召回时既能找到精确片段，也能知道它来自
同一个原始回合。

---

### 连接相关的人、项目和工具

MemX 包含关系图记忆能力。它可以维护项目、仓库、工具、人物、资源、卡点和结果之间的关系。
当同一个对象被换了不同叫法时，MemX 可以在有证据支持的情况下把它们连到同一个对象上。

例如一个项目先叫 “Raven”，后来被叫作 “Raven API” 或 “auth repo”，MemX 可以保留这些叫法
之间的联系，而不是把它们拆成几份互不相干的记忆。

---

### 从协作中学习你的习惯

MemX 可以从多次工作中学到稳定模式。比如你更喜欢小步、可回滚的改动；某个项目改 UI 前总要
先核对 API；或者一类任务通常要先跑特定检查。

这些学习结果不会脱离来源。MemX 会保留支撑它们的原始证据，避免生成没有依据的空泛总结。

---

### 自动维护记忆的新旧关系

MemX 会持续整理记忆：

- 多次出现的信息可以变成稳定记忆；
- 用户纠正后，新信息可以替代旧信息；
- 已过期的任务状态不会长期压过当前状态；
- 高层总结仍能回到原始证据；
- OpenClaw heartbeat 这类后台控制消息不会污染记忆。

这样记忆不会慢慢变成一堆旧聊天记录，而是随着工作变化持续更新。

---

### 只召回当前需要的证据

MemX 不会把所有相关记忆都塞进 prompt。它会在事实、事件、任务状态、对话片段、关系、资源和
已学到的工作习惯里搜索，然后把当前问题最需要的证据整理成简短可读的几行。

agent 得到的是可以直接用来回答问题的证据，而不是杂乱的记忆堆。

## 测试信号

在当前内部长期工程记忆 replay 测试中，MemX 达到了 **100% expected memory evidence recall**：
预期证据能够被写入、召回，并进入 prompt 注入链路。

## OpenClaw quickstart

依赖：OpenClaw 2026.3.25+，Node.js 22.14+ 或 Node 24。只有使用本地 embedding 时才需要
Python 3。

`memx quickstart openclaw` 是 OpenClaw 专用入口。它会写入 OpenClaw 配置，安装 OpenClaw
memory plugin，设置 `plugins.slots.memory`，重启 Gateway，并运行 MemX doctor 检查。
Codex、Claude Code 和其它 MCP agent 使用下面的[多 agent 适配](#多-agent-适配)流程。

最短的 DeepSeek 示例：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart openclaw --api-key sk-your-deepseek-key
```

quickstart 命令默认使用 GitHub package spec。每次全新执行都会拉取 GitHub 当前代码，因此 README
安装流程不需要等待 npm publish。如果你之后明确要用 npm 稳定发布通道，再把
`github:NeoLi00/openclaw-memx` 换成 `@neoli00/memory-memx`。

这只是 provider 示例。MemX 可以使用任何 OpenClaw 能调用的 OpenAI-compatible provider。
使用通用 provider 时，传入 provider endpoint，并分别选择一个主 agent 模型和一个快速、低成本的
语义 compiler 模型：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart openclaw \
  --preset custom \
  --provider-id my-provider \
  --base-url https://llm.example.com/v1 \
  --agent-model my-main-model \
  --memx-model my-fast-model \
  --api-key sk-your-provider-key
```

embedding 默认配置：

- embedding provider：`sentence-transformers-local`
- embedding 模型：`intfloat/multilingual-e5-small`
- 本地 embedding Python：`~/.openclaw/memx/.venv/bin/python`

quickstart 会创建本地 embedding venv，安装 `sentence-transformers` 和 `torch`，通过
`openclaw plugins install github:NeoLi00/openclaw-memx` 安装 MemX 插件，写入 MemX 配置，重启 Gateway，
并运行 `openclaw memx doctor --deep`。

如果不想把 API key 直接写进 `~/.openclaw/openclaw.json`，可以写入 env SecretRef：

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
npx -y -p github:NeoLi00/openclaw-memx memx quickstart openclaw --api-key-env DEEPSEEK_API_KEY
```

常用 embedding 覆盖项：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart openclaw \
  --api-key sk-your-deepseek-key \
  --embedding-model intfloat/multilingual-e5-small
```

使用 `--dry-run` 可以只预览将写入的配置和 exec-form 命令，不实际写文件或运行安装器。
如果你已经装好了本地 embedding 的 Python 依赖，可以加 `--skip-embedding-deps`。

本地开发且希望实时使用当前源码时，可以在克隆仓库内用 link 方式安装，避免复制到 OpenClaw 的
托管插件目录：

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx
openclaw plugins install --link .
openclaw memx setup --local-embedding
openclaw gateway restart
openclaw memx doctor --deep
```

## 多 agent 适配

MemX 现在提供三类接入面：

- **OpenClaw 原生 memory plugin**：现有 `memory-memx` 插件接管 `plugins.slots.memory`，
  通过 `before_prompt_build` 注入召回结果，通过 `agent_end` 捕获完成后的 turn。
- **Codex 和 Claude Code 原生插件资产**：`.codex-plugin/plugin.json` 与
  `.claude-plugin/plugin.json` 会注册同一个 MemX MCP server 和宿主生命周期 hooks。
- **通用 MCP**：其它支持 MCP 的 agent 可以只接入 `memx` MCP server。

Codex、Claude Code 或通用 MCP client 使用 standalone quickstart。它会写入 MemX 自己的
`~/.memx/config.json`，不再依赖 OpenClaw config。

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart codex \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

Claude Code 只需要换 target：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart claude-code \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

通用 MCP client 可以生成 MemX config，并输出通用 MCP JSON：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart mcp \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

standalone quickstart 默认使用本地 embedding：

- embedding provider：`sentence-transformers-local`
- embedding 模型：`intfloat/multilingual-e5-small`
- Python venv：`~/.memx/.venv/bin/python`

如果不想把 key 直接写进 config，用 `--llm-api-key-env PROVIDER_API_KEY`。如果要远程
embedding，用 `--embedding-provider`、`--embedding-model`、`--embedding-base-url` 和
`--embedding-api-key`。

配置完成后启动本地服务：

```bash
npx -y -p github:NeoLi00/openclaw-memx memx-server
```

Codex 和 Claude Code 原生插件 hook 捕获仍然使用 `MEMX_URL`（默认 `http://localhost:3878`）。
内置 hook 使用 `command` 加 `args` 的 exec-form，而不是 shell 命令字符串，因此插件安装器不需要
做 shell tokenization。

OpenClaw 用户首次安装应优先使用 `memx quickstart openclaw`。源码开发时仍然可以用
`openclaw plugins install --link .` 加 `openclaw memx setup`。

## `memx setup` 会改什么

`memx quickstart openclaw` 会写入和 `openclaw memx setup` 相同的 MemX 插件设置，并额外写入
所选 OpenClaw LLM provider 和 `agents.defaults.model.primary`。

`openclaw memx setup` 是插件安装后的正常配置步骤。它会写入推荐的 OpenClaw 配置：

- 把 `memory-memx` 加进 `plugins.allow`；
- 把 `plugins.slots.memory` 设为 `memory-memx`，让 MemX 接管 OpenClaw 的 memory slot；
- 打开 `plugins.entries.memory-memx.hooks.allowPromptInjection`，让召回到的记忆作为运行时上下文
  注入到 agent 回答前；
- 启用 turn scheduler，以及召回、写入、维护链路使用的 LLM 语义编译路径；
- 保持 `advanced.enableCompatibilityMemoryTools=false`，因此 MemX 不会暴露兼容旧流程的
  `memory_search` / `memory_get` 工具，也不会把旧的 `MEMORY.md` / `memory/*.md` 召回提示和
  MemX 召回并行塞进 prompt；
- 根据命令参数选择 embedding provider/model；使用 `--local-embedding` 时会写入推荐的本地
  embedding 配置。

`memx setup` 不会删除或迁移已有的 `MEMORY.md`。MemX 注入的召回上下文也会要求 agent 不要把
`MEMORY.md` 或 `memory/*.md` 当作当前活动记忆后端，除非用户明确询问这些文件。如果你有旧的
`MEMORY.md` 笔记，应当有意识地迁移，而不是让两套记忆系统同时生效。

## 模型和 embedding 配置

### Standalone hosts

Codex、Claude Code 和通用 MCP 使用 MemX standalone config，不使用 `openclaw.json`。

quickstart 参数会直接写入 `~/.memx/config.json`：

- `--llm-provider`：`openai-compatible`、`anthropic`、`google` 或 `ollama`
- `--llm-base-url`：provider endpoint base URL
- `--llm-model`：MemX 语义 compiler 使用的模型
- `--llm-api-key` 或 `--llm-api-key-env`：provider API key
- `--embedding-provider`：`sentence-transformers-local`、`openai-compatible`、`ollama` 或 `off`
- `--embedding-model`：embedding 模型，默认 `intfloat/multilingual-e5-small`

`memx-server` 也支持这些运行时覆盖：`MEMX_CONFIG_PATH`、`MEMX_LLM_PROVIDER`、
`MEMX_LLM_BASE_URL`、`MEMX_LLM_MODEL`、`MEMX_LLM_API_KEY`、`MEMX_EMBEDDING_PROVIDER`、
`MEMX_EMBEDDING_MODEL`、`MEMX_EMBEDDING_BASE_URL`、`MEMX_EMBEDDING_API_KEY`、
`MEMX_EMBEDDING_OLLAMA_BASE_URL`、`MEMX_EMBEDDING_PYTHON`、`MEMX_EMBEDDING_CACHE_DIR` 和
`MEMX_EMBEDDING_DEVICE`。

### 复用已有 OpenClaw provider

MemX 可以复用 OpenClaw 已有的兼容 provider。如果你已经配置好了 provider，只需要指定
MemX 使用哪个 provider/model：

```bash
openclaw config set plugins.entries.memory-memx.config.advanced.llmClassifierModel provider/model
```

`openclaw memx setup --local-embedding` 会选择推荐的本地
`sentence-transformers-local` provider 和模型。你只需要给 OpenClaw 使用的 Python runtime 安装
依赖：

```bash
python3 -m pip install --user sentence-transformers torch
```

如果使用虚拟环境，在 setup 时传入对应的 Python：

```bash
openclaw memx setup --local-embedding --embedding-python /path/to/.venv/bin/python
openclaw gateway restart
```

### 自选 embedding provider

`openclaw memx setup --local-embedding` 只是推荐默认值。你可以用同一个 setup 命令选择其他
embedding provider，需要额外字段时再配合 `openclaw config set`。

本地 sentence-transformers，并自选模型：

```bash
python3 -m pip install --user sentence-transformers torch
openclaw memx setup \
  --embedding-provider sentence-transformers-local \
  --embedding-model BAAI/bge-m3 \
  --embedding-device auto
```

OpenAI-compatible embedding：

```bash
openclaw memx setup \
  --embedding-provider openai-compatible \
  --embedding-model text-embedding-3-small
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey "sk-your-embedding-key"
```

Ollama embedding：

```bash
openclaw memx setup \
  --embedding-provider ollama \
  --embedding-model nomic-embed-text
openclaw config set plugins.entries.memory-memx.config.embedding.ollamaBaseURL http://127.0.0.1:11434
```

关闭向量 embedding，只使用词法 fallback：

```bash
openclaw memx setup --embedding-provider off
```

修改 embedding 设置后，重启 Gateway。如果已经有历史记忆，重新索引一次，让向量库匹配新的
embedding provider：

```bash
openclaw gateway restart
openclaw memx reindex
```

### 推荐的成本质量平衡组合

下面不是唯一选择，只是推荐用于平衡成本、质量、多语言召回和本地优先：

| 层 | 推荐选择 | 原因 |
| --- | --- | --- |
| LLM compiler | 任意兼容的 OpenClaw LLM provider；给 `--memx-model` 选择一个快速、低成本模型 | 语义规划质量足够做记忆编译 |
| Embedding | `intfloat/multilingual-e5-small` | 本地运行，多语言召回，不产生 embedding API 费用 |
