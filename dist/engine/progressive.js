"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressiveDialer = void 0;
const events_1 = require("events");
class ProgressiveDialer extends events_1.EventEmitter {
    name = "progressive";
    totalDials = 0;
    totalConnected = 0;
    calculateDialRate(_campaignId, context) {
        const availableSlots = context.availableAgents - context.activeCalls;
        const dialRate = Math.max(0, availableSlots);
        this.emit("pacing:calculated", {
            engine: this.name,
            requestedCalls: dialRate,
            availableAgents: context.availableAgents,
            activeCalls: context.activeCalls,
        });
        return dialRate;
    }
    updateMetrics(metrics) {
        this.totalDials = metrics.totalDials;
        this.totalConnected = metrics.totalConnected;
    }
    reset() {
        this.totalDials = 0;
        this.totalConnected = 0;
    }
}
exports.ProgressiveDialer = ProgressiveDialer;
//# sourceMappingURL=progressive.js.map