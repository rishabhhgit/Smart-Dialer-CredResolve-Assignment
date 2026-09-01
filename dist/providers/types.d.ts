export interface OutboundCallRequest {
    callId: string;
    phoneNumber: string;
    campaignId: string;
    metadata?: Record<string, unknown>;
}
export interface ProviderCallEvent {
    providerCallId: string;
    callId: string;
    status: "RINGING" | "ANSWERED" | "COMPLETED" | "FAILED" | "TIMEOUT";
    timestamp: number;
    duration?: number;
    reason?: string;
}
export type ProviderEventCallback = (event: ProviderCallEvent) => void;
export interface TelecomProvider {
    readonly name: string;
    readonly isHealthy: boolean;
    initiateCall(request: OutboundCallRequest): Promise<{
        providerCallId: string;
    }>;
    hangupCall(providerCallId: string): Promise<void>;
    onEvent(callback: ProviderEventCallback): void;
    removeEventCallback(callback: ProviderEventCallback): void;
    getMetrics(): ProviderMetrics;
}
export interface ProviderMetrics {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    avgLatency: number;
    isHealthy: boolean;
    lastError?: string;
}
//# sourceMappingURL=types.d.ts.map