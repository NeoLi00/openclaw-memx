import type { TurnCaptureMessage } from "../types.js";
type CaptureParams = {
    agentId: string;
    scope: string;
    sessionKey: string;
    turnId: string;
    observedAt: string;
    messages: unknown[];
    recalledTexts?: string[];
};
export declare function captureAgentEndTurn(params: CaptureParams): TurnCaptureMessage[];
export {};
