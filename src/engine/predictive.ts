import { EventEmitter } from "events";
import { PacingEngine, DialContext, PacingMetrics } from "./types";

export class PredictiveDialer extends EventEmitter implements PacingEngine {
  readonly name = "predictive";
  private totalDials = 0;
  private totalConnected = 0;
  private historicalAnswerRate = 0.5;
  private historicalCallDuration = 120;
  private movingAverageWindow: number[] = [];
  private durationWindow: number[] = [];
  private readonly WINDOW_SIZE = 20;
  private targetAbandonRate = 0.03;
  private readonly MAX_SAFETY_MARGIN = 1.0;
  private readonly MIN_SAFETY_MARGIN = 0.1;
  private readonly TARGET_OCCUPANCY = 0.85;

  calculateDialRate(_campaignId: string, context: DialContext): number {
    this.updateAverages(context);

    const { availableAgents, activeCalls, ringingCalls, connectedCalls } = context;

    if (availableAgents === 0) return 0;

    const answerRate = this.historicalAnswerRate;
    const avgDuration = this.historicalCallDuration;

    const trafficIntensity = this.calculateTrafficIntensity(
      availableAgents,
      answerRate,
      avgDuration
    );

    const erlangC = this.erlangC(availableAgents, trafficIntensity);
    const targetOccupancy = Math.min(
      this.TARGET_OCCUPANCY,
      answerRate * 1.15
    );

    const baseDials = this.calculateBaseDials(
      availableAgents,
      trafficIntensity,
      erlangC.waitingProbability,
      targetOccupancy
    );

    const safetyMargin = this.calculateSafetyMargin(context);
    const adjustedCalls = Math.floor(baseDials * safetyMargin);

    const ringingCapacity = Math.max(
      0,
      Math.floor(availableAgents * 0.3) - ringingCalls
    );

    const callsNeeded = Math.max(0, adjustedCalls - activeCalls);
    const requestedCalls = Math.min(callsNeeded, ringingCapacity);

    const finalCalls =
      answerRate > 0.1
        ? Math.ceil(requestedCalls / answerRate)
        : requestedCalls;

    this.emit("pacing:calculated", {
      engine: this.name,
      requestedCalls: finalCalls,
      availableAgents,
      activeCalls,
      connectedCalls,
      targetOccupancy,
      answerRate,
      trafficIntensity,
      erlangCWaitingProbability: erlangC.waitingProbability,
      erlangCServiceLevel: erlangC.serviceLevel,
      safetyMargin,
    });

    return finalCalls;
  }

  private calculateTrafficIntensity(
    agents: number,
    answerRate: number,
    avgDuration: number
  ): number {
    const arrivalRate = agents * answerRate;
    const serviceRate = 1 / (avgDuration / 60);
    return arrivalRate / serviceRate;
  }

  private erlangC(
    agents: number,
    trafficIntensity: number
  ): { waitingProbability: number; serviceLevel: number } {
    if (agents <= 0 || trafficIntensity <= 0) {
      return { waitingProbability: 1, serviceLevel: 0 };
    }

    if (trafficIntensity >= agents) {
      return { waitingProbability: 1, serviceLevel: 0 };
    }

    const rho = trafficIntensity / agents;

    let poissonSum = 0;
    for (let k = 0; k < agents; k++) {
      poissonSum += Math.pow(trafficIntensity, k) / this.factorial(k);
    }

    const lastTerm =
      Math.pow(trafficIntensity, agents) /
      this.factorial(agents) /
      (1 - rho);

    const denominator = poissonSum + lastTerm;
    const waitingProbability = lastTerm / denominator;

    const targetWaitTime = 20;
    const serviceLevel =
      1 - waitingProbability * Math.exp(-agents * (1 - rho) / targetWaitTime);

    return {
      waitingProbability: Math.min(1, Math.max(0, waitingProbability)),
      serviceLevel: Math.min(1, Math.max(0, serviceLevel)),
    };
  }

  private calculateBaseDials(
    agents: number,
    trafficIntensity: number,
    waitingProbability: number,
    targetOccupancy: number
  ): number {
    const occupancyBasedDials = Math.floor(
      agents * targetOccupancy * (agents / trafficIntensity)
    );

    const waitingAdjustment = 1 + waitingProbability * 0.3;
    const adjustedDials = Math.floor(occupancyBasedDials * waitingAdjustment);

    return Math.max(1, adjustedDials);
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= Math.min(n, 20); i++) {
      result *= i;
    }
    return result;
  }

  private calculateSafetyMargin(context: DialContext): number {
    let margin = this.MAX_SAFETY_MARGIN;

    if (context.avgAnswerRate < 0.2) {
      margin *= 0.3;
    } else if (context.avgAnswerRate < 0.3) {
      margin *= 0.5;
    } else if (context.avgAnswerRate < 0.5) {
      margin *= 0.75;
    }

    if (context.ringingCalls > context.availableAgents * 0.4) {
      margin *= 0.5;
    } else if (context.ringingCalls > context.availableAgents * 0.3) {
      margin *= 0.7;
    }

    if (context.activeCalls > 0 && context.availableAgents > 0) {
      const utilization =
        context.activeCalls / (context.availableAgents + context.activeCalls);
      if (utilization > 0.95) {
        margin *= 0.2;
      } else if (utilization > 0.9) {
        margin *= 0.3;
      } else if (utilization > 0.7) {
        margin *= 0.6;
      }
    }

    if (context.callsInLastMinute > 0) {
      const recentFailRate =
        1 - context.answeredInLastMinute / context.callsInLastMinute;
      if (recentFailRate > 0.7) {
        margin *= 0.2;
      } else if (recentFailRate > 0.5) {
        margin *= 0.4;
      }
    }

    if (context.connectedCalls > 0 && context.activeCalls > 0) {
      const connectRatio = context.connectedCalls / context.activeCalls;
      if (connectRatio < 0.3) {
        margin *= 0.4;
      }
    }

    return Math.max(this.MIN_SAFETY_MARGIN, Math.min(this.MAX_SAFETY_MARGIN, margin));
  }

  private updateAverages(context: DialContext): void {
    if (context.answeredInLastMinute > 0 && context.callsInLastMinute > 0) {
      const currentRate = context.answeredInLastMinute / context.callsInLastMinute;
      this.movingAverageWindow.push(currentRate);
      if (this.movingAverageWindow.length > this.WINDOW_SIZE) {
        this.movingAverageWindow.shift();
      }
      this.historicalAnswerRate =
        this.movingAverageWindow.reduce((a, b) => a + b, 0) /
        this.movingAverageWindow.length;
    }

    if (context.avgCallDuration > 0) {
      this.durationWindow.push(context.avgCallDuration);
      if (this.durationWindow.length > this.WINDOW_SIZE) {
        this.durationWindow.shift();
      }
      this.historicalCallDuration =
        this.durationWindow.reduce((a, b) => a + b, 0) /
        this.durationWindow.length;
    }
  }

  updateMetrics(metrics: PacingMetrics): void {
    this.totalDials = metrics.totalDials;
    this.totalConnected = metrics.totalConnected;
  }

  reset(): void {
    this.totalDials = 0;
    this.totalConnected = 0;
    this.historicalAnswerRate = 0.5;
    this.historicalCallDuration = 120;
    this.movingAverageWindow = [];
    this.durationWindow = [];
  }

  getHistoricalAnswerRate(): number {
    return this.historicalAnswerRate;
  }

  getHistoricalCallDuration(): number {
    return this.historicalCallDuration;
  }
}
