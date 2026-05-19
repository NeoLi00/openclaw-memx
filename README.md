<p align="center">
  <img src="./assets/memx-cover-en.svg" alt="MemX - self-learning, self-maintaining memory for AI agents" width="920">
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a> ·
  <a href="./ARCHITECTURE.md">Architecture</a>
</p>

---

MemX turns completed work into structured, searchable, self-maintained memory, then injects only the evidence an agent needs for the current query.
It connects natively to Codex, Claude Code, and OpenClaw, and reaches any MCP-compatible client through the same local memory layer.

## Benchmarks

<table align="center">
  <thead>
    <tr>
      <th>Suite</th>
      <th>Scope</th>
      <th>R@3 success rate</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>LongMemEval-S</strong></td>
      <td>Long-context memory retrieval</td>
      <td><strong>94.2%</strong></td>
    </tr>
    <tr>
      <td><strong>Real engineering cases</strong></td>
      <td>30 cases, each with 20+ turns</td>
      <td><strong>100%</strong></td>
    </tr>
  </tbody>
</table>

## Architecture

<p align="center">
  <img src="./assets/memx-overview.svg" alt="MemX coarse architecture" width="920">
</p>

## Agent support

<table align="center">
  <tr>
    <td align="center" width="56"><img src="./assets/agent-logos/codex.png" alt="Codex logo" width="34"></td>
    <td><strong>Codex</strong></td>
    <td><sub>native + hooks + MCP</sub></td>
  </tr>
  <tr>
    <td align="center" width="56"><img src="./assets/agent-logos/claude-code.png" alt="Claude Code logo" width="34"></td>
    <td><strong>Claude Code</strong></td>
    <td><sub>native + hooks + MCP</sub></td>
  </tr>
  <tr>
    <td align="center" width="56"><img src="./assets/agent-logos/openclaw.png" alt="OpenClaw logo" width="34"></td>
    <td><strong>OpenClaw</strong></td>
    <td><sub>native + hooks</sub></td>
  </tr>
  <tr>
    <td align="center" width="56"><strong>MCP</strong></td>
    <td><strong>MCP clients</strong></td>
    <td><sub>any MCP-compatible client</sub></td>
  </tr>
</table>

## Quick start

Requirements: Node.js 22.14+ or Node 24. OpenClaw installs require OpenClaw 2026.3.25+. Python 3 is
needed only for the default local embedding runtime.

The README commands use the GitHub package spec. A fresh run pulls current GitHub code, so installs
do not wait for an npm publish. To use the npm release channel later, replace
`github:NeoLi00/openclaw-memx` with `@neoli00/memory-memx`.

Fill in these values before running a command:

- `--llm-provider`: the provider adapter MemX should call. Choose one of `openai-compatible`,
  `anthropic`, `google`, or `ollama`.
- `--llm-base-url`: the base URL for that provider. Examples: `https://api.openai.com/v1`,
  `https://api.anthropic.com/v1`, `https://generativelanguage.googleapis.com/v1beta`, or
  `http://127.0.0.1:11434` for Ollama.
- `--llm-model`: the model MemX uses for memory compilation, recall planning, and maintenance.
  Pick a fast, low-cost model with reliable JSON output.
- `--llm-api-key`: the API key for the provider. Use `--llm-api-key-env PROVIDER_API_KEY` if you
  want the config to reference an environment variable instead of storing plaintext. For local
  Ollama, omit the key.

The default embedding setup is local `sentence-transformers-local` with
`intfloat/multilingual-e5-small`. Add `--embedding-provider` and `--embedding-model` only when you
want to override that default. Use `--dry-run` to preview the files and exec-form commands before
writing anything.

### Claude Code

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart claude-code \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

### Codex

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart codex \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

### OpenClaw

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart openclaw \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

### Generic MCP

```bash
npx -y -p github:NeoLi00/openclaw-memx memx quickstart mcp \
  --llm-provider openai-compatible \
  --llm-base-url https://llm.example.com/v1 \
  --llm-model fast-memory-model \
  --llm-api-key sk-your-provider-key
```

For Claude Code, Codex, and generic MCP clients, start the shared local service after configuration:

```bash
npx -y -p github:NeoLi00/openclaw-memx memx-server
```

## What MemX can do

- **Remember work over time**: project decisions, user preferences, task status, long source
  segments, and raw evidence stay linked to the original turn.
- **Connect related things**: projects, repos, tools, files, resources, blockers, and outcomes can
  be represented as entities and graph edges.
- **Learn collaboration patterns**: repeated evidence can become reusable guidance without losing
  its supporting sources.
- **Maintain itself**: corrections can supersede older facts, stable evidence can be promoted, and
  stale task state stops competing with current state.
- **Recall compact evidence**: facts, events, state, chunks, relationships, resources, and learned
  patterns are searched together, then injected as small evidence lines.
