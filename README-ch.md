<p align="center">
  <img src="./assets/memx-architecture.svg" alt="MemX 架构图" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>面向长期工作的 OpenClaw agent 的自学习、自维护、图记忆系统。</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
</p>

---

MemX 是一个面向 OpenClaw 的本地优先长期记忆插件。它针对的不是短问短答，而是真实
agent 长期工作场景：工程任务会跨越多天，项目名会变化，用户会纠正旧信息，工作流会
逐步稳定，实体关系会形成图，旧状态也会过期。

MemX 不是简单的“记忆表”。它是一套多层记忆系统：

- **图记忆**：实体、别名、身份链接、项目关系、资源关系、多跳召回。
- **自学习记忆**：信号、belief、习惯、策略、workflow pattern。
- **自维护记忆**：consolidation、abstraction、promotion、supersession、decay、currentness。
- **证据级召回**：不是把所有记忆塞进 prompt，而是注入当前问题真正需要的 evidence packet。

它的目标是让 agent 长期和你一起工作：记住变化，连接对象，学习重复模式，避免旧状态误导，
并在需要时找回可追溯的原始证据。

## 为什么需要 MemX

普通记忆插件通常擅长“存一条笔记”。但长期工作的 agent 需要处理更复杂的情况：

- 同一个项目可能在几周内被叫成不同名字。
- 用户可能纠正之前的事实。
- 一个任务会从 active 变成 blocked，再变成 resolved。
- 用户习惯和工作偏好往往需要多次交互才能形成。
- 图关系有时比单条句子更重要。
- 工程对话很长，召回需要证据，不应该只靠模糊 summary。

MemX 把记忆看成一个会演化的系统：先保留原始证据，再形成 canonical objects，然后通过
maintenance 升级出 graph、belief、strategy，最后在召回时只注入当前真正有用的证据。

## 核心能力

### 图记忆

MemX 不只依赖文本相似度，而是显式维护实体和关系。

- entity mention、alias、identity link 会解析到 canonical entity。
- graph edge 连接人物、项目、工具、仓库、资源、地点、blocker、outcome。
- query 侧 entity expansion 可以召回相关 fact、event、state、strategy、graph path。
- 用户使用旧别名时，仍然可以路由到当前 canonical entity。

这让 agent 能够在证据支持时理解 “Raven”、“Raven API”、“auth repo” 可能是同一个项目的不同表达。

### 自学习记忆

MemX 有 control layer 来承载 learning signals、belief 和 strategy hypotheses。

- retrieval support、contradiction、correction、outcome feedback 会进入 signal ledger。
- 重复出现并且有证据支持的信息可以形成 belief lifecycle。
- 已解决任务、明确 workflow guidance、稳定工作模式可以形成 strategy。
- belief 和 strategy 都保留 source refs，不是凭空生成的抽象总结。

这让 agent 可以逐步学习长期工作偏好，例如“用户更喜欢小步可回滚的 patch”，或者
“这个项目改 UI 前通常要先核对 API contract”。

### 自维护记忆

MemX 的 maintenance 不是后台第二个 raw-text parser，而是保真升级层。

- consolidation 把重复结构化证据升级成稳定 fact 或 graph edge。
- abstraction jobs 生成 derived state、workflow pattern、graph hypothesis、concept candidate。
- promotion 只在有 lineage 和 support refs 时 materialize durable objects。
- supersession、currentness、decay 防止旧事实、旧 blocker、旧 task state 压过当前状态。

maintenance 的输出仍能追溯到原始证据，所以召回可以从高层对象扩展回 raw chunk / event。

### 证据级召回

MemX 的召回链路由 compiler 驱动。

- query compiler 生成 evidence goals、roles、semantic bridges。
- candidate generation 分层搜索 fact、event、state、chunk、graph、resource、strategy。
- source expansion 补回 raw support 和邻近上下文。
- evidence packet 统一排序，再以简短可读的形式进入 system prompt。

最终给 agent 的不是“记忆垃圾堆”，而是可用于当前回答的证据。

### 默认本地混合召回

MemX 默认使用本地 `sentence-transformers` embedding，模型是
`intfloat/multilingual-e5-small`。

- 默认不需要 embedding API key。
- 本地 embedding 冷启动或不可用时，会 fallback 到 lexical retrieval。
- 超长输入和输出会切成同一 source family 下的 segments，既能精确召回片段，也能保留原始 turn 的整体性。

### 避免 heartbeat 污染

OpenClaw heartbeat 和 control turn 会被过滤，不会触发完整记忆写入、semantic compilation 或
maintenance，避免后台心跳污染长期记忆。

## 记忆层级

- **Scene 层**：turn、chunk、task、session continuity。
- **Canonical 层**：fact、state、event、entity、graph edge。
- **Control 层**：belief、signal、strategy、abstraction、promotion lifecycle。
- **Recall 层**：vector doc、candidate trace、source expansion、prompt evidence packet。

## 当前测试信号

在当前内部长期工程记忆 replay 测试中，MemX 达到了 **100% expected memory evidence recall**：
预期证据能够被写入、召回，并进入 prompt 注入链路。

这是当前测试集上的效果信号，不代表对所有未来场景作绝对保证。

## 安装流程

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

## Provider key 复用

如果 OpenClaw 已经配置了 LLM provider，MemX 不需要单独配置一份 LLM key。它会读取
OpenClaw 配置里的 `models.providers.<provider>.apiKey` 和 headers，并按 provider 类型发起
compiler / reasoner 请求。

Embedding 默认是本地 `sentence-transformers-local`，不需要 API key。如果你改成
`openai-compatible` embedding，需要单独配置 MemX 的 embedding key：

```bash
openclaw config set plugins.entries.memory-memx.config.embedding.provider openai-compatible
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey '${OPENAI_API_KEY}'
openclaw config set plugins.entries.memory-memx.config.embedding.model text-embedding-3-small
```

