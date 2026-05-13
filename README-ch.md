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

## 快速安装

依赖：OpenClaw 2026.3.25+，Node.js 22.14+ 或 Node 24。只有使用本地 embedding 时才需要
Python 3。

从 GitHub 源码安装插件，写入推荐的 MemX 配置，重启 Gateway，然后验证。这里默认
OpenClaw 已经配置了可用的模型 provider。如果这是全新的 OpenClaw，先配置 provider，或者按下面的
DeepSeek 示例配置后再依赖 LLM 记忆编译。

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx
openclaw plugins install .
openclaw memx setup --local-embedding
openclaw gateway restart
openclaw memx doctor --deep
```

请在干净 clone 中、安装开发依赖之前运行 `openclaw plugins install .`。如果目录里已经有
`node_modules`，请换一个干净 clone 或先移除 `node_modules`，这样 OpenClaw 的安装扫描只会看到插件包文件。

本地开发且希望实时使用当前源码时，可以在克隆仓库内用 link 方式安装，避免复制到 OpenClaw 的
托管插件目录：

```bash
openclaw plugins install --link .
```

## `memx setup` 会改什么

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

### 全新 OpenClaw 配置 LLM provider

如果 OpenClaw 还没有任何 provider，先配置一个 LLM provider，再让 MemX 使用这个
provider/model，最后重启并运行 deep doctor 探针。下面的命令只把 DeepSeek 当作示例；你可以用任意
兼容的 OpenClaw 模型 provider，只要把 `deepseek/deepseek-v4-flash` 换成自己的
`provider/model`。

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx
openclaw plugins install .

python3 -m venv "$HOME/.openclaw/memx/.venv"
"$HOME/.openclaw/memx/.venv/bin/python" -m pip install -U pip sentence-transformers torch

openclaw config set models.providers.deepseek '{
  "api": "openai-completions",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-your-deepseek-key",
  "models": [
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "api": "openai-completions",
      "reasoning": false,
      "input": ["text"],
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
      "contextWindow": 64000,
      "maxTokens": 8192
    }
  ]
}' --strict-json

openclaw memx setup \
  --local-embedding \
  --embedding-python "$HOME/.openclaw/memx/.venv/bin/python" \
  --llm-model deepseek/deepseek-v4-flash
openclaw gateway restart
openclaw memx doctor --deep
```

如果不想把 API key 直接写进 `~/.openclaw/openclaw.json`，也可以写入环境变量模板，但要确保
Gateway 进程能读到这个环境变量：

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
openclaw config set models.providers.deepseek '{
  "api": "openai-completions",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "models": [
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "api": "openai-completions",
      "reasoning": false,
      "input": ["text"],
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
      "contextWindow": 64000,
      "maxTokens": 8192
    }
  ]
}' --strict-json
```

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
| LLM compiler | 任意兼容的 OpenClaw LLM provider；DeepSeek V4 Flash 只是一个低成本示例 | 语义规划质量足够做记忆编译 |
| Embedding | `intfloat/multilingual-e5-small` | 本地运行，多语言召回，不产生 embedding API 费用 |
