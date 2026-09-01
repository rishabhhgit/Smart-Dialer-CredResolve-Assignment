import { SafetyController } from "../src/safety/controller";
import { SafetyContext } from "../src/safety/types";

describe("SafetyController", () => {
  let controller: SafetyController;

  beforeEach(() => {
    controller = new SafetyController();
  });

  test("should approve pacing request with sufficient agents", () => {
    const context: SafetyContext = {
      availableAgents: 50,
      activeCalls: 10,
      connectedCalls: 8,
      ringingCalls: 2,
      failedCallsLast5Min: 0,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: true },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "campaign_1", requestedCalls: 10, reason: "test" },
      context
    );

    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.allowedCalls).toBeGreaterThan(0);
    }
  });

  test("should reduce calls when providers unhealthy", () => {
    const context: SafetyContext = {
      availableAgents: 3,
      activeCalls: 10,
      connectedCalls: 5,
      ringingCalls: 5,
      failedCallsLast5Min: 10,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: false, providerB: true },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "campaign_1", requestedCalls: 5, reason: "test" },
      context
    );

    // Should reject due to unhealthy providers with limited agents
    expect(decision.approved).toBe(false);
  });

  test("should fallback to progressive when utilization too low", () => {
    const context: SafetyContext = {
      availableAgents: 50,
      activeCalls: 30,
      connectedCalls: 5,
      ringingCalls: 25,
      failedCallsLast5Min: 5,
      totalCallsLast5Min: 40,
      providerHealth: { providerA: true },
      avgAnswerRate: 0.3,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "campaign_1", requestedCalls: 20, reason: "test" },
      context
    );

    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.allowedCalls).toBe(1); // Progressive fallback
    }
  });

  test("should not exceed available agents", () => {
    const context: SafetyContext = {
      availableAgents: 10,
      activeCalls: 8,
      connectedCalls: 5,
      ringingCalls: 3,
      failedCallsLast5Min: 0,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: true },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "campaign_1", requestedCalls: 50, reason: "test" },
      context
    );

    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.allowedCalls).toBeLessThanOrEqual(2); // max 0, but safety margin
    }
  });

  test("should track metrics", () => {
    const context: SafetyContext = {
      availableAgents: 50,
      activeCalls: 10,
      connectedCalls: 8,
      ringingCalls: 2,
      failedCallsLast5Min: 0,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: true },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    controller.evaluatePacing(
      { campaignId: "campaign_1", requestedCalls: 10, reason: "test" },
      context
    );

    const metrics = controller.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.approved).toBe(1);
  });
});
