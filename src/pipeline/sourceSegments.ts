import { stableHash } from "../support.js";
import type { ConversationChunk, SourceSegmentRecord, VectorDocRecord } from "../types.js";
import { CHUNK_VECTOR_CONFIDENCE } from "./constants.js";
import { buildVectorDocMetadata } from "./vectorDocMetadata.js";

export const SOURCE_SEGMENT_TARGET_CHARS = 1800;
export const SOURCE_SEGMENT_OVERLAP_CHARS = 220;

function segmentBoundary(
  text: string,
  start: number,
  idealEnd: number,
  targetChars: number,
): number {
  if (idealEnd >= text.length) {
    return text.length;
  }
  const minEnd = Math.min(text.length, start + Math.floor(targetChars * 0.6));
  let boundary = text.lastIndexOf("\n\n", idealEnd);
  if (boundary >= minEnd) {
    return boundary + 2;
  }
  boundary = text.lastIndexOf("\n", idealEnd);
  if (boundary >= minEnd) {
    return boundary + 1;
  }
  boundary = text.lastIndexOf(" ", idealEnd);
  if (boundary >= minEnd) {
    return boundary + 1;
  }
  return idealEnd;
}

export function splitSourceText(
  text: string,
  params?: { targetChars?: number; overlapChars?: number },
): Array<{ index: number; start: number; end: number; text: string }> {
  const targetChars = Math.max(400, params?.targetChars ?? SOURCE_SEGMENT_TARGET_CHARS);
  const overlapChars = Math.min(
    Math.max(0, params?.overlapChars ?? SOURCE_SEGMENT_OVERLAP_CHARS),
    targetChars - 1,
  );
  if (!text.trim()) {
    return [];
  }
  if (text.length <= targetChars) {
    return [{ index: 0, start: 0, end: text.length, text }];
  }
  const segments: Array<{ index: number; start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < text.length) {
    const idealEnd = Math.min(text.length, start + targetChars);
    const end = segmentBoundary(text, start, idealEnd, targetChars);
    const segmentText = text.slice(start, end);
    if (segmentText.trim()) {
      segments.push({
        index: segments.length,
        start,
        end,
        text: segmentText,
      });
    }
    if (end >= text.length) {
      break;
    }
    const nextStart = Math.max(0, end - overlapChars);
    start = nextStart > start ? nextStart : end;
  }
  return segments;
}

export function sourceGroupIdForChunk(chunk: ConversationChunk): string {
  return `source_group:${stableHash([chunk.agentId, chunk.scope, chunk.sourceRef])}`;
}

export function buildSourceSegmentsForChunk(chunk: ConversationChunk): SourceSegmentRecord[] {
  const sourceGroupId = sourceGroupIdForChunk(chunk);
  const parts = splitSourceText(chunk.content);
  return parts.map((part) => {
    const segmentId = `segment:${stableHash([
      chunk.chunkId,
      chunk.sourceRef,
      String(part.index),
      String(part.start),
      String(part.end),
    ])}`;
    return {
      segmentId,
      sourceGroupId,
      parentSourceRef: chunk.sourceRef,
      chunkId: chunk.chunkId,
      agentId: chunk.agentId,
      scope: chunk.scope,
      sessionKey: chunk.sessionKey,
      turnId: chunk.turnId,
      seq: chunk.seq,
      role: chunk.role,
      toolName: chunk.toolName,
      segmentIndex: part.index,
      charStart: part.start,
      charEnd: part.end,
      text: part.text,
      contentHash: stableHash([chunk.contentHash, String(part.index), part.text]),
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt,
      metadataJson: {
        sourceGroupId,
        parentSourceRef: chunk.sourceRef,
        chunkId: chunk.chunkId,
        role: chunk.role,
        sessionKey: chunk.sessionKey,
        segmentIndex: part.index,
        charStart: part.start,
        charEnd: part.end,
        segmentCount: parts.length,
      },
    };
  });
}

export function buildSourceSegmentVectorDocs(params: {
  chunk: ConversationChunk;
  segments: SourceSegmentRecord[];
}): VectorDocRecord[] {
  if (params.segments.length <= 1) {
    return [];
  }
  return params.segments.map((segment) => ({
    docId: `event:source-segment:${segment.segmentId}`,
    docKind: "event",
    sourceId: segment.segmentId,
    scope: segment.scope,
    agentId: segment.agentId,
    text: `${segment.role}: ${segment.text}`,
    metadataJson: buildVectorDocMetadata({
      docType: "source_segment",
      confidence: CHUNK_VECTOR_CONFIDENCE,
      observedAt: segment.createdAt,
      lineage: {
        sourceKind: "chunk",
        sourceId: segment.chunkId,
        sourceRef: segment.parentSourceRef,
      },
      extra: {
        chunkId: segment.chunkId,
        role: segment.role,
        sessionKey: segment.sessionKey,
        sourceGroupId: segment.sourceGroupId,
        parentSourceRef: segment.parentSourceRef,
        segmentId: segment.segmentId,
        segmentIndex: segment.segmentIndex,
        segmentCount: params.segments.length,
        charStart: segment.charStart,
        charEnd: segment.charEnd,
      },
    }),
    createdAt: segment.createdAt,
    updatedAt: segment.updatedAt,
  }));
}
