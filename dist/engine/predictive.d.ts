import { EventEmitter } from "events";
import { PacingEngine, DialContext, PacingMetrics } from "./types";
export declare class PredictiveDialer extends EventEmitter implements PacingEngine {
    readonly name = "predictive";
    private totalDials;
    private totalConnected;
    private historicalAnswerRate;
    private historicalCallDuration;
    private movingAverageWindow;
    private readonly WINDOW_SIZE;
    calculateDialRate(_campaignId: string, context: DialContext): number;
    private updateAverages;
    updateMetrics(metrics: PacingMetrics): void;
    reset(): void;
    getHistoricalAnswerRate(): number;
}
//# sourceMappingURL=predictive.d.ts.map