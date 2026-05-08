import type { TurnCaptureRole } from "../types.js";

const BOOTSTRAP_FILE_PATH_RE =
  /\b(?:BOOTSTRAP|IDENTITY|USER|SOUL|MEMORY)\.md\b|\bmemory\/\d{4}-\d{2}-\d{2}\.md\b/i;

const BOOTSTRAP_SETUP_RE =
  /(?:\b(?:first (?:time|conversation|run)|just woke up|who am i|who are you|identity information|identity details|initial setup|setup and introduction|determine (?:my|your) identity|identity files?|update(?:ing)?\s+(?:user|identity)\.md|create(?:ing)?\s+(?:today'?s\s+)?memory file|record(?:ing)?\s+our conversation|check current memory files|memory file(?:s)?|conversation context|according to BOOTSTRAP\.md|bootstrap\.md guidance)\b|引导文件|身份信息|初次启动|初次对话|第一次在这个工作空间运行|建立身份信息|更新USER\.md|更新IDENTITY\.md|记录我们的对话|让我先创建今天的记忆文件|现在让我更新USER\.md文件|建立对话上下文|填写身份文件|设置身份文件)/i;

const BOOTSTRAP_TEMPLATE_RE =
  /(?:#\s*(?:BOOTSTRAP\.md|IDENTITY\.md|USER\.md)\b|Fill this in during your first conversation|About Your Human|Who Am I\?|You just woke up|Hello, World|## Memory Context|## Working State|## Stable Facts|## Conversation Memory|## Alternates|\bSender \(untrusted metadata\):)/i;

const GENERIC_FILE_TOOL_RE = /^(?:read|write|edit)$/i;

export function isBootstrapMemoryContamination(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return (
    BOOTSTRAP_FILE_PATH_RE.test(normalized) ||
    BOOTSTRAP_SETUP_RE.test(normalized) ||
    BOOTSTRAP_TEMPLATE_RE.test(normalized)
  );
}

export function shouldSuppressCapturedMessage(params: {
  role: TurnCaptureRole;
  content: string;
  toolName?: string;
}): boolean {
  const { role, content, toolName } = params;
  if (role === "assistant" || role === "user") {
    return isBootstrapMemoryContamination(content);
  }
  if (role === "tool") {
    if (
      toolName &&
      !GENERIC_FILE_TOOL_RE.test(toolName) &&
      !isBootstrapMemoryContamination(content)
    ) {
      return false;
    }
    return isBootstrapMemoryContamination(content);
  }
  return false;
}

export function filterBootstrapRows<T extends { text: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isBootstrapMemoryContamination(row.text));
}
