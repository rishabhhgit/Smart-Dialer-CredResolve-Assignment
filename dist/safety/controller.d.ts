import { EventEmitter } from "events";
import { SafetyControllerInterface, PacingRequest, SafetyContext, SafetyDecision, SafetyEvent, SafetyMetrics } from "./types";
export declare class SafetyController extends EventEmitter implements SafetyControllerInterface {
    private readonly config?;
    private metrics;
    private recentEvents;
    private readonly MAX_ABANDONED_RATE;
    private readonly MAX_FAILED_RATE;
    private readonly PROGRESSIVE_FALLBACK_THRESHOLD;
    private enabled;
    constructor(config?: {
        maxAbandonedRate?: number;
        maxFailedRate?: number;
        progressiveFallbackThreshold?: number;
    } | undefined);
    evaluatePacing(request: PacingRequest, context: SafetyContext): SafetyDecision;
    private calculateSafetyMargin;
    reportEvent(event: SafetyEvent): void;
    getMetrics(): SafetyMetrics;
    reset(): void;
    private recordDecision;
}
//# sourceMappingURL=controller.d.ts.map