import { AgentManager, AgentState } from "../src/models/agent";
import { CallManager, CallState } from "../src/models/call";
import { SafetyController } from "../src/safety/controller";
import { SharedStateManager } from "../src/dialer/sharedState";

describe("Concurrency Safety", () => {
  let agentManager: AgentManager;
  let callManager: CallManager;

  beforeEach(() => {
    agentManager = new AgentManager();
    callManager = new CallManager();
  });

  test("two workers cannot reserve the same agent simultaneously", async () => {
    agentManager.createAgent("agent_1", "campaign_1");

    const reservation1 = await agentManager.reserveAgent("agent_1", "call_1", "worker_1");
    expect(reservation1).not.toBeNull();

    const reservation2 = await agentManager.reserveAgent("agent_1", "call_2", "worker_2");
    expect(reservation2).toBeNull();

    const agent = agentManager.getAgent("agent_1");
    expect(agent?.state).toBe(AgentState.RESERVED);
    expect(agent?.currentCallId).toBe("call_1");
  });

  test("second worker picks different agent when first is reserved", async () => {
    agentManager.createAgent("agent_1", "campaign_1");
    agentManager.createAgent("agent_2", "campaign_1");

    await agentManager.reserveAgent("agent_1", "call_1", "worker_1");

    const reservation2 = await agentManager.reserveAgent("agent_2", "call_2", "worker_2");
    expect(reservation2).not.toBeNull();
    expect(reservation2?.agentId).toBe("agent_2");
  });

  test("shared state manager prevents double reservation", async () => {
    const sharedState = new SharedStateManager();
    const agent = agentManager.createAgent("agent_1", "campaign_1");
    const call = callManager.createCall("campaign_1", "borrower_1");

    sharedState.registerAgent(agent);
    sharedState.registerCall(call);

    const result1 = await sharedState.tryReserveAgent("agent_1", "call_1", "worker_1");
    expect(result1).toBe(true);

    const result2 = await sharedState.tryReserveAgent("agent_1", "call_2", "worker_2");
    expect(result2).toBe(false);

    const agentState = sharedState.getAgent("agent_1");
    expect(agentState?.state).toBe(AgentState.RESERVED);
  });
});

describe("Call State Machine Edge Cases", () => {
  let callManager: CallManager;

  beforeEach(() => {
    callManager = new CallManager();
  });

  test("duplicate ANSWERED events are ignored", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);
    await callManager.transitionCall(call.id, CallState.INITIATED);
    await callManager.transitionCall(call.id, CallState.RINGING);
    await callManager.transitionCall(call.id, CallState.ANSWERED);

    const result = await callManager.transitionCall(call.id, CallState.ANSWERED);
    expect(result).toBe(false);

    expect(callManager.getCall(call.id)?.state).toBe(CallState.ANSWERED);
  });

  test("COMPLETED after ANSWERED is valid", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);
    await callManager.transitionCall(call.id, CallState.INITIATED);
    await callManager.transitionCall(call.id, CallState.RINGING);
    await callManager.transitionCall(call.id, CallState.ANSWERED);
    await callManager.transitionCall(call.id, CallState.CONNECTED);
    await callManager.transitionCall(call.id, CallState.COMPLETED);

    expect(callManager.getCall(call.id)?.state).toBe(CallState.COMPLETED);
  });

  test("ANSWERED after COMPLETED is rejected", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);
    await callManager.transitionCall(call.id, CallState.INITIATED);
    await callManager.transitionCall(call.id, CallState.RINGING);
    await callManager.transitionCall(call.id, CallState.ANSWERED);
    await callManager.transitionCall(call.id, CallState.CONNECTED);
    await callManager.transitionCall(call.id, CallState.COMPLETED);

    const result = await callManager.transitionCall(call.id, CallState.ANSWERED);
    expect(result).toBe(false);

    expect(callManager.getCall(call.id)?.state).toBe(CallState.COMPLETED);
  });

  test("RINGING after CONNECTED is rejected", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);
    await callManager.transitionCall(call.id, CallState.INITIATED);
    await callManager.transitionCall(call.id, CallState.RINGING);
    await callManager.transitionCall(call.id, CallState.ANSWERED);
    await callManager.transitionCall(call.id, CallState.CONNECTED);

    const result = await callManager.transitionCall(call.id, CallState.RINGING);
    expect(result).toBe(false);

    expect(callManager.getCall(call.id)?.state).toBe(CallState.CONNECTED);
  });

  test("FAILED from any active state is valid", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);

    const result = await callManager.transitionCall(call.id, CallState.FAILED, "timeout");
    expect(result).toBe(true);
    expect(callManager.getCall(call.id)?.state).toBe(CallState.FAILED);
  });

  test("CANCELLED from QUEUED is valid", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");

    const result = await callManager.transitionCall(call.id, CallState.CANCELLED);
    expect(result).toBe(true);
    expect(callManager.getCall(call.id)?.state).toBe(CallState.CANCELLED);
  });

  test("state history tracks all transitions", async () => {
    const call = callManager.createCall("campaign_1", "borrower_1");
    await callManager.transitionCall(call.id, CallState.RESERVED);
    await callManager.transitionCall(call.id, CallState.INITIATED);
    await callManager.transitionCall(call.id, CallState.RINGING);
    await callManager.transitionCall(call.id, CallState.ANSWERED);
    await callManager.transitionCall(call.id, CallState.CONNECTED);
    await callManager.transitionCall(call.id, CallState.COMPLETED);

    const history = callManager.getCall(call.id)?.stateHistory;
    expect(history).toBeDefined();
    expect(history!.length).toBe(7);
    expect(history![0].state).toBe(CallState.QUEUED);
    expect(history![6].state).toBe(CallState.COMPLETED);
  });
});

describe("Agent State Machine Edge Cases", () => {
  let agentManager: AgentManager;

  beforeEach(() => {
    agentManager = new AgentManager();
  });

  test("agent can go through full lifecycle", async () => {
    const agent = agentManager.createAgent("agent_1", "campaign_1");

    expect(agent.state).toBe(AgentState.AVAILABLE);

    await agentManager.reserveAgent("agent_1", "call_1", "worker_1");
    expect(agentManager.getAgent("agent_1")?.state).toBe(AgentState.RESERVED);

    agentManager.transitionState(agent, AgentState.DIALING);
    expect(agent.state).toBe(AgentState.DIALING);

    agentManager.transitionState(agent, AgentState.CONNECTED);
    expect(agent.state).toBe(AgentState.CONNECTED);

    agentManager.releaseAgent("agent_1", AgentState.WRAP_UP);
    expect(agent.state).toBe(AgentState.WRAP_UP);

    agentManager.releaseAgent("agent_1", AgentState.AVAILABLE);
    expect(agent.state).toBe(AgentState.AVAILABLE);
  });

  test("agent cannot skip states", () => {
    const agent = agentManager.createAgent("agent_1", "campaign_1");

    expect(agentManager.transitionState(agent, AgentState.CONNECTED)).toBe(false);
    expect(agent.state).toBe(AgentState.AVAILABLE);

    expect(agentManager.transitionState(agent, AgentState.WRAP_UP)).toBe(false);
    expect(agent.state).toBe(AgentState.AVAILABLE);
  });

  test("offline agent cannot be reserved", async () => {
    agentManager.createAgent("agent_1", "campaign_1");
    agentManager.setAgentOffline("agent_1");

    const reservation = await agentManager.reserveAgent("agent_1", "call_1", "worker_1");
    expect(reservation).toBeNull();
  });

  test("agent transition events emit correct from/to", () => {
    agentManager.createAgent("agent_1", "campaign_1");
    const agent = agentManager.getAgent("agent_1")!;

    const events: any[] = [];
    agentManager.on("agent:transition", (data) => events.push(data));

    agentManager.transitionState(agent, AgentState.RESERVED);
    agentManager.transitionState(agent, AgentState.DIALING);

    expect(events.length).toBe(2);
    expect(events[0].from).toBe(AgentState.AVAILABLE);
    expect(events[0].to).toBe(AgentState.RESERVED);
    expect(events[1].from).toBe(AgentState.RESERVED);
    expect(events[1].to).toBe(AgentState.DIALING);
  });
});

describe("Safety Controller Edge Cases", () => {
  let controller: SafetyController;

  beforeEach(() => {
    controller = new SafetyController();
  });

  test("rejects when all providers unhealthy and few agents", () => {
    const context = {
      availableAgents: 3,
      activeCalls: 10,
      connectedCalls: 5,
      ringingCalls: 5,
      failedCallsLast5Min: 10,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: false, providerB: false },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "c1", requestedCalls: 5, reason: "test" },
      context
    );

    expect(decision.approved).toBe(false);
  });

  test("allows when providers healthy", () => {
    const context = {
      availableAgents: 50,
      activeCalls: 10,
      connectedCalls: 8,
      ringingCalls: 2,
      failedCallsLast5Min: 0,
      totalCallsLast5Min: 20,
      providerHealth: { providerA: true, providerB: true },
      avgAnswerRate: 0.5,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "c1", requestedCalls: 10, reason: "test" },
      context
    );

    expect(decision.approved).toBe(true);
  });

  test("reduces calls when ringing too high", () => {
    const context = {
      availableAgents: 20,
      activeCalls: 15,
      connectedCalls: 10,
      ringingCalls: 12,
      failedCallsLast5Min: 0,
      totalCallsLast5Min: 30,
      providerHealth: { providerA: true },
      avgAnswerRate: 0.6,
      avgCallDuration: 120,
    };

    const decision = controller.evaluatePacing(
      { campaignId: "c1", requestedCalls: 10, reason: "test" },
      context
    );

    expect(decision.approved).toBe(true);
    if (decision.approved) {
      expect(decision.allowedCalls).toBeLessThan(10);
    }
  });

  test("tracks all metrics correctly", () => {
    const context = {
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
      { campaignId: "c1", requestedCalls: 10, reason: "test" },
      context
    );

    controller.evaluatePacing(
      { campaignId: "c1", requestedCalls: 100, reason: "test" },
      context
    );

    const metrics = controller.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.approved + metrics.reduced + metrics.rejected + metrics.fallbackToProgressive).toBeGreaterThanOrEqual(2);
  });

  test("can be reset", () => {
    const context = {
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
      { campaignId: "c1", requestedCalls: 10, reason: "test" },
      context
    );

    controller.reset();
    const metrics = controller.getMetrics();
    expect(metrics.totalRequests).toBe(0);
  });
});

describe("Shared State Manager", () => {
  let sharedState: SharedStateManager;

  beforeEach(() => {
    sharedState = new SharedStateManager();
  });

  test("registers and tracks agents", () => {
    const agentManager = new AgentManager();
    const agent = agentManager.createAgent("agent_1", "campaign_1");

    sharedState.registerAgent(agent);

    const state = sharedState.getAgent("agent_1");
    expect(state).toBeDefined();
    expect(state?.state).toBe(AgentState.AVAILABLE);
  });

  test("registers and tracks calls", () => {
    const callManager = new CallManager();
    const call = callManager.createCall("campaign_1", "borrower_1");

    sharedState.registerCall(call);

    const state = sharedState.getCall(call.id);
    expect(state).toBeDefined();
    expect(state?.state).toBe(CallState.QUEUED);
  });

  test("reserves agent atomically", async () => {
    const agentManager = new AgentManager();
    const callManager = new CallManager();
    const agent = agentManager.createAgent("agent_1", "campaign_1");
    const call = callManager.createCall("campaign_1", "borrower_1");

    sharedState.registerAgent(agent);
    sharedState.registerCall(call);

    const result = await sharedState.tryReserveAgent("agent_1", call.id, "worker_1");
    expect(result).toBe(true);

    const agentState = sharedState.getAgent("agent_1");
    expect(agentState?.state).toBe(AgentState.RESERVED);
  });

  test("concurrent reservations only succeed once", async () => {
    const agentManager = new AgentManager();
    const agent = agentManager.createAgent("agent_1", "campaign_1");
    sharedState.registerAgent(agent);

    const results = await Promise.all([
      sharedState.tryReserveAgent("agent_1", "call_1", "worker_1"),
      sharedState.tryReserveAgent("agent_1", "call_2", "worker_2"),
    ]);

    const successCount = results.filter((r) => r === true).length;
    expect(successCount).toBe(1);
  });

  test("getStats returns correct counts", () => {
    const agentManager = new AgentManager();
    const callManager = new CallManager();

    const agent1 = agentManager.createAgent("agent_1", "campaign_1");
    const agent2 = agentManager.createAgent("agent_2", "campaign_1");
    const call1 = callManager.createCall("campaign_1", "borrower_1");

    sharedState.registerAgent(agent1);
    sharedState.registerAgent(agent2);
    sharedState.registerCall(call1);

    const stats = sharedState.getStats("campaign_1");
    expect(stats.totalAgents).toBe(2);
    expect(stats.availableAgents).toBe(2);
    expect(stats.totalCalls).toBe(1);
  });
});
