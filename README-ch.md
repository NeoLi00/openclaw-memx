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
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
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

## 安装

依赖：OpenClaw 2026.4.25+，Node.js 22.14+ 或 Node 24。只有使用本地
sentence-transformers embedding 时才需要 Python 3。

按下面顺序执行。`git clone` 和插件安装只需要做一次。

### 1. 确认 OpenClaw 已有 LLM provider

MemX 可以复用任意兼容的 OpenClaw 模型 provider。如果 OpenClaw 已经有可用 provider，记下它的
模型名 `provider/model`，然后直接进入第 2 步。

如果是全新的 OpenClaw，先配置一个 provider。下面只用 DeepSeek V4 Flash 做示例；你可以换成任意
兼容的 provider/model。

```bash
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
```

用这个示例时，MemX 后面要填的模型名是 `deepseek/deepseek-v4-flash`。

如果不想把 API key 直接写进 `~/.openclaw/openclaw.json`，可以在同一个 provider JSON 里使用环境
变量模板：

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
```

然后把 provider JSON 里的 `"apiKey"` 写成 `"${DEEPSEEK_API_KEY}"`，并确保 Gateway 进程能读到
这个环境变量。

### 2. 克隆并安装 MemX

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx
openclaw plugins install .
```

如果是本地开发，希望 OpenClaw 直接使用当前源码，把最后一行换成 link 安装：

```bash
openclaw plugins install --link .
```

### 3. 准备本地 embedding

```bash
python3 -m venv "$HOME/.openclaw/memx/.venv"
"$HOME/.openclaw/memx/.venv/bin/python" -m pip install -U pip sentence-transformers torch
```

这会安装推荐本地 embedding provider 需要的 Python 依赖。

### 4. 写入 MemX 配置

把 `provider/model` 换成你的 OpenClaw 模型，比如 `deepseek/deepseek-v4-flash`。

```bash
openclaw memx setup \
  --local-embedding \
  --embedding-python "$HOME/.openclaw/memx/.venv/bin/python" \
  --llm-model provider/model
```

只有在你希望 MemX 直接使用 OpenClaw 当前默认模型时，才可以省略 `--llm-model provider/model`。

### 5. 重启并验证

```bash
openclaw gateway restart
openclaw memx doctor --deep
```

## 自选 embedding provider

上面的安装流程使用推荐的本地 embedding。如果你想换 provider，用下面任一方案替换第 3 步和第 4 步，
然后继续执行第 5 步。

### 本地 sentence-transformers，自选模型

```bash
python3 -m venv "$HOME/.openclaw/memx/.venv"
"$HOME/.openclaw/memx/.venv/bin/python" -m pip install -U pip sentence-transformers torch

openclaw memx setup \
  --embedding-provider sentence-transformers-local \
  --embedding-model BAAI/bge-m3 \
  --embedding-python "$HOME/.openclaw/memx/.venv/bin/python" \
  --embedding-device auto \
  --llm-model provider/model
```

### OpenAI-compatible embedding

```bash
openclaw memx setup \
  --embedding-provider openai-compatible \
  --embedding-model text-embedding-3-small \
  --llm-model provider/model
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey "sk-your-embedding-key"
```

### Ollama embedding

```bash
openclaw memx setup \
  --embedding-provider ollama \
  --embedding-model nomic-embed-text \
  --llm-model provider/model
openclaw config set plugins.entries.memory-memx.config.embedding.ollamaBaseURL http://127.0.0.1:11434
```

### 关闭向量 embedding

```bash
openclaw memx setup --embedding-provider off --llm-model provider/model
```

这会关闭向量 embedding，只使用词法 fallback。

如果是在已有记忆数据库上修改 embedding 设置，重启 Gateway 并重新索引：

```bash
openclaw gateway restart
openclaw memx reindex
```

## 推荐的成本质量平衡组合

下面不是唯一选择，只是推荐用于平衡成本、质量、多语言召回和本地优先：

| 层 | 推荐选择 | 原因 |
| --- | --- | --- |
| LLM compiler | 任意兼容的 OpenClaw LLM provider；DeepSeek V4 Flash 只是一个低成本示例 | 语义规划质量足够做记忆编译 |
| Embedding | `intfloat/multilingual-e5-small` | 本地运行，多语言召回，不产生 embedding API 费用 |
