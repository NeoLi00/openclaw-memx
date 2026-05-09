type HeartbeatHookContext = {
    sessionKey?: string;
    messageProvider?: string;
    trigger?: string;
};
type HeartbeatHookEvent = {
    prompt?: string;
    messages?: unknown[];
};
export declare function isHeartbeatAckText(text: string): boolean;
export declare function isHeartbeatControlText(text: string): boolean;
export declare function shouldSkipMemxForHeartbeat(event: HeartbeatHookEvent | undefined, ctx: HeartbeatHookContext): boolean;
export {};
