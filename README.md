<p align="center">
  <img src="./assets/memx-architecture.svg" alt="MemX architecture" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>Compiler-guided, entity-aware long-term memory for agents that work across days, projects, and evolving tasks.</strong>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

---

## English

MemX is a local-first memory plugin for OpenClaw. It is built for real agent work:
long-running engineering conversations, evolving project state, user preferences,
corrections, graph relationships, workflow habits, and evidence-backed recall.

Unlike a simple memory table, MemX runs a multi-layer memory pipeline:

- **Scene memory** for turns, chunks, tasks, and session continuity.
- **Canonical memory** for facts, states, events, entities, and graph edges.
- **Control memory** for beliefs, strategies, habits, maintenance lifecycle, and promotion.
- **Recall memory** for vector documents, retrieval traces, source expansion, and prompt evidence.

The design goal is simple: remember enough to work with you over time, but inject only the
evidence that helps the current task.

### Why MemX is different

- **Compiler-first write path**  
  A semantic compiler interprets new turns, while policy and normalization keep the write path
  deterministic, auditable, and source-traceable.

- **Evidence-driven recall**  
  Query compilation produces evidence goals and semantic bridges. Candidate generation searches
  facts, events, states, chunks, graph neighborhoods, resources, and strategies separately, then
  assembles ranked evidence packets.

- **Entity-aware graph memory**  
  Mentions, aliases, identity links, graph edges, beliefs, and strategies share a resolver contract
  so the same project, person, repo, tool, or resource can stay connected across different names.

- **Maintenance as a fidelity upgrade layer**  
  Consolidation, abstraction, belief aggregation, and promotion consume structured upstream output
  and preserve source lineage. Maintenance is not a second raw-text parser.

- **Local hybrid retrieval by default**  
  MemX defaults to local `sentence-transformers` embeddings using `intfloat/multilingual-e5-small`.
  If local embeddings are unavailable, it falls back to lexical retrieval instead of breaking recall.

- **Long-context friendly capture**  
  Long inputs and outputs are stored as linked source segments, so recall can retrieve precise
  slices while preserving the original turn as one logical source.

- **Heartbeat-safe**  
  OpenClaw heartbeat/control turns are filtered so background liveness checks do not create memory.

### Current evaluation signal

In the current internal long-running engineering-memory replay suite, MemX reached **100% recall of
the expected memory evidence**. This means the expected evidence was written, retrievable, and
available to prompt injection in the tested scenarios. It is an evaluation signal, not a universal
guarantee for every future workload.

### Installation

Requirements:

- OpenClaw with Node.js 22+
- `git`
- Python 3 for local sentence-transformers embeddings
- A configured OpenClaw LLM provider, or the DeepSeek example below

Clone and install:

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx

openclaw plugins install .
openclaw plugins enable memory-memx
```

Install local embedding dependencies:

```bash
python3 -m pip install --user sentence-transformers torch
```

Configure DeepSeek V4 Flash as the OpenClaw model provider:

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"

openclaw config set models.providers.deepseek.api openai-completions
openclaw config set models.providers.deepseek.baseUrl https://api.deepseek.com
openclaw config set models.providers.deepseek.apiKey '${DEEPSEEK_API_KEY}'

openclaw config set agents.defaults.model.primary deepseek/deepseek-v4-flash
openclaw config set plugins.entries.memory-memx.config.advanced.llmClassifierModel deepseek/deepseek-v4-flash
```

Configure MemX with multilingual E5 local embeddings:

```bash
openclaw config set plugins.entries.memory-memx.config.enabled true
openclaw config set plugins.entries.memory-memx.config.autoCapture true
openclaw config set plugins.entries.memory-memx.config.autoRecall true
openclaw config set plugins.entries.memory-memx.config.reflectionEnabled true

openclaw config set plugins.entries.memory-memx.config.embedding.provider sentence-transformers-local
openclaw config set plugins.entries.memory-memx.config.embedding.model intfloat/multilingual-e5-small
openclaw config set plugins.entries.memory-memx.config.embedding.localDevice auto
```

Restart the OpenClaw gateway after installation or config changes:

```bash
openclaw gateway run --bind loopback --force
```

Verify:

```bash
openclaw plugins list
openclaw plugins info memory-memx
openclaw plugins doctor
```

### Provider key reuse

MemX does not need a separate LLM API key when OpenClaw already has a provider configured.
It reads the selected provider from OpenClaw config and reuses `models.providers.<provider>.apiKey`
and custom headers.

For embeddings, the default local provider does not need an API key. If you switch embeddings to
`openai-compatible`, configure the MemX embedding key separately:

```bash
openclaw config set plugins.entries.memory-memx.config.embedding.provider openai-compatible
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey '${OPENAI_API_KEY}'
openclaw config set plugins.entries.memory-memx.config.embedding.model text-embedding-3-small
```

---

## 中文

MemX 是一个面向 OpenClaw 的本地优先记忆插件。它不是简单的“记忆表”，而是为真实
agent 长期工作设计的多层记忆系统：工程任务会跨越多天，项目状态会变化，用户偏好会
被纠正，实体关系会演化，策略和习惯也需要从多次交互中逐步形成。

MemX 的核心目标是：长期记住足够多的工作上下文，但每次回答只注入当前真正有用的证据。

### MemX 记忆层级

- **Scene 层**：turn、chunk、task、session continuity。
- **Canonical 层**：fact、state、event、entity、graph edge。
- **Control 层**：belief、strategy、habit、maintenance lifecycle、promotion。
- **Recall 层**：vector doc、retrieval trace、source expansion、prompt evidence。

### 特殊能力

- **Compiler-first 写入链路**  
  LLM compiler 负责开放语义理解；policy、normalize、materialization 负责确定性收口、
  source lineage 和安全写入。

- **Evidence-driven 召回链路**  
  query compiler 会把问题编译成 evidence goal 和 semantic bridge；candidate generation
  分层召回 fact、event、state、chunk、graph、resource、strategy；最终由 evidence packet
  决定 prompt 注入。

- **Entity-aware graph memory**  
  mention、alias、identity link、graph edge、belief、strategy 共用实体解析契约，避免同一个
  项目、人物、仓库、资源因为不同叫法被拆成多条孤立记忆线。

- **Maintenance 是保真升级层**  
  consolidation、abstraction、belief aggregation、promotion 只消费写入链路已经产出的结构化
  信息和 source refs，不重新做后台 raw-text 语义解析。

- **默认本地混合召回**  
  默认启用 `sentence-transformers-local`，模型为 `intfloat/multilingual-e5-small`。如果本地
  embedding 暂不可用，MemX 会 fallback 到 lexical retrieval，而不是让召回直接失效。

- **适配长输入和长输出**  
  超长用户输入、长报告、长 agent 回复会被切成共享 source family 的 source segments，召回时
  可以精确命中片段，同时保留“这是同一个原始 turn”的整体性。

- **规避 heartbeat 噪声**  
  OpenClaw heartbeat / control turn 不会触发完整记忆写入和 maintenance，避免后台心跳污染记忆。

### 当前测试信号

在当前内部长期工程记忆 replay 测试中，MemX 达到了 **100% expected memory evidence recall**：
预期证据能够被写入、召回，并进入 prompt 注入链路。这是当前测试集上的效果信号，不代表对所有
未来场景作绝对保证。

### 安装流程

依赖：

- OpenClaw 和 Node.js 22+
- `git`
- Python 3，用于本地 sentence-transformers embedding
- 已配置的 OpenClaw LLM provider，或者使用下面的 DeepSeek V4 Flash 示例

克隆并安装：

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx

openclaw plugins install .
openclaw plugins enable memory-memx
```

安装本地 embedding 依赖：

```bash
python3 -m pip install --user sentence-transformers torch
```

配置 DeepSeek V4 Flash：

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"

openclaw config set models.providers.deepseek.api openai-completions
openclaw config set models.providers.deepseek.baseUrl https://api.deepseek.com
openclaw config set models.providers.deepseek.apiKey '${DEEPSEEK_API_KEY}'

openclaw config set agents.defaults.model.primary deepseek/deepseek-v4-flash
openclaw config set plugins.entries.memory-memx.config.advanced.llmClassifierModel deepseek/deepseek-v4-flash
```

配置 multilingual E5 small 本地 embedding：

```bash
openclaw config set plugins.entries.memory-memx.config.enabled true
openclaw config set plugins.entries.memory-memx.config.autoCapture true
openclaw config set plugins.entries.memory-memx.config.autoRecall true
openclaw config set plugins.entries.memory-memx.config.reflectionEnabled true

openclaw config set plugins.entries.memory-memx.config.embedding.provider sentence-transformers-local
openclaw config set plugins.entries.memory-memx.config.embedding.model intfloat/multilingual-e5-small
openclaw config set plugins.entries.memory-memx.config.embedding.localDevice auto
```

安装或修改配置后重启 gateway：

```bash
openclaw gateway run --bind loopback --force
```

检查插件状态：

```bash
openclaw plugins list
openclaw plugins info memory-memx
openclaw plugins doctor
```

### Provider key 复用

如果 OpenClaw 已经配置了 LLM provider，MemX 不需要单独配置一份 LLM key。它会读取
OpenClaw 配置里的 `models.providers.<provider>.apiKey` 和 headers，并按 provider 类型发起
compiler/reasoner 请求。

Embedding 默认是本地 `sentence-transformers-local`，不需要 API key。如果你改成
`openai-compatible` embedding，需要单独配置 MemX 的 embedding key。

