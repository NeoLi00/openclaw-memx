import type { TurnCaptureRole } from "../types.js";
export declare function isBootstrapMemoryContamination(text: string): boolean;
export declare function shouldSuppressCapturedMessage(params: {
    role: TurnCaptureRole;
    content: string;
    toolName?: string;
}): boolean;
export declare function filterBootstrapRows<T extends {
    text: string;
}>(rows: T[]): T[];
