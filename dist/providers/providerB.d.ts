import { TelecomProvider, OutboundCallRequest, ProviderEventCallback, ProviderMetrics } from "./types";
export interface ProviderBConfig {
    failureRate: number;
    timeoutRate: number;
    duplicateRate: number;
    outOfOrderRate: number;
    baseLatency: number;
}
export declare class ProviderB implements TelecomProvider {
    readonly name = "ProviderB";
    private eventCallbacks;
    private callCounter;
    private healthy;
    private metrics;
    private config;
    private pendingEvents;
    constructor(config?: Partial<ProviderBConfig>);
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
    setConfig(config: Partial<ProviderBConfig>): void;
}
//# sourceMappingURL=providerB.d.ts.map