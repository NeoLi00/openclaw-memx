<p align="center">
  <img src="./assets/memx-architecture-zh.svg" alt="MemX 架构图" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>包含自学习、自维护和关系图记忆能力的 OpenClaw 长期记忆插件。</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
</p>

---

MemX 是一个面向 OpenClaw 的本地优先长期记忆插件。它不是为了短问短答设计的，而是为了
真实 agent 长期工作：跨天推进工程任务，记住项目变化，理解用户偏好，处理纠错，连接相关
人物、项目、工具和文件。

它不是把聊天记录堆起来，而是帮助 agent 做这些事：

- 记住长期稳定的事实、偏好和工作背景；
- 跟踪当前任务、卡点、下一步和已完成事项；
- 连接人物、项目、工具、文件、资源和决策之间的关系；
- 从反复协作中学会你的工作习惯；
- 自动整理旧信息、纠错信息和过期状态；
- 回答时只注入当前问题真正需要的证据。

## 它能做什么

### 长期记住工作上下文

MemX 会保留长对话里真正有用的信息：项目决策、用户偏好、任务状态、重要事件和原始证据。
超长输入和超长 agent 回复会被切成相互关联的片段，召回时既能找到精确片段，也能知道它来自
同一个原始回合。

### 连接相关的人、项目和工具

MemX 包含关系图记忆能力。它可以维护项目、仓库、工具、人物、资源、卡点和结果之间的关系。
当同一个对象被换了不同叫法时，MemX 可以在有证据支持的情况下把它们连到同一个对象上。

例如一个项目先叫 “Raven”，后来被叫作 “Raven API” 或 “auth repo”，MemX 可以保留这些叫法
之间的联系，而不是把它们拆成几份互不相干的记忆。

### 从协作中学习你的习惯

MemX 可以从多次工作中学到稳定模式。比如你更喜欢小步、可回滚的改动；某个项目改 UI 前总要
先核对 API；或者一类任务通常要先跑特定检查。

这些学习结果不会脱离来源。MemX 会保留支撑它们的原始证据，避免生成没有依据的空泛总结。

### 自动维护记忆的新旧关系

MemX 会持续整理记忆：

- 多次出现的信息可以变成稳定记忆；
- 用户纠正后，新信息可以替代旧信息；
- 已过期的任务状态不会长期压过当前状态；
- 高层总结仍能回到原始证据；
- OpenClaw heartbeat 这类后台控制消息不会污染记忆。

这样记忆不会慢慢变成一堆旧聊天记录，而是随着工作变化持续更新。

### 只召回当前需要的证据

MemX 不会把所有相关记忆都塞进 prompt。它会在事实、事件、任务状态、对话片段、关系、资源和
已学到的工作习惯里搜索，然后把当前问题最需要的证据整理成简短可读的几行。

agent 得到的是可以直接用来回答问题的证据，而不是杂乱的记忆堆。

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

