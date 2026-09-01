export interface PacingEngine {
    readonly name: string;
    calculateDialRate(campaignId: string, context: DialContext): number;
    updateMetrics(metrics: PacingMetrics): void;
    reset(): void;
}
export interface DialContext {
    availableAgents: number;
    activeCalls: number;
    connectedCalls: number;
    ringingCalls: number;
    avgAnswerRate: number;
    avgCallDuration: number;
    callsInLastMinute: number;
    answeredInLastMinute: number;
}
export interface PacingMetrics {
    totalDials: number;
    totalConnected: number;
    utilization: number;
    answerRate: number;
}
//# sourceMappingURL=types.d.ts.map