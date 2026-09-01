import { EventEmitter } from "events";
import { PacingEngine, DialContext, PacingMetrics } from "./types";
export declare class ProgressiveDialer extends EventEmitter implements PacingEngine {
    readonly name = "progressive";
    private totalDials;
    private totalConnected;
    calculateDialRate(_campaignId: string, context: DialContext): number;
    updateMetrics(metrics: PacingMetrics): void;
    reset(): void;
}
//# sourceMappingURL=progressive.d.ts.map