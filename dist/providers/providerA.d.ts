import { TelecomProvider, OutboundCallRequest, ProviderEventCallback, ProviderMetrics } from "./types";
export declare class ProviderA implements TelecomProvider {
    readonly name = "ProviderA";
    private eventCallbacks;
    private callCounter;
    private healthy;
    private metrics;
    get isHealthy(): boolean;
    initiateCall(request: OutboundCallRequest): Promise<{
        providerCallId: string;
    }>;
    hangupCall(providerCallId: string): Promise<void>;
    onEvent(callback: ProviderEventCallback): void;
    removeEventCallback(callback: ProviderEventCallback): void;
    private emitEvent;
    getMetrics(): ProviderMetrics;
    setHealthy(healthy: boolean): void;
}
//# sourceMappingURL=providerA.d.ts.map