import { AgentManager, AgentState } from "../src/models/agent";

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    manager = new AgentManager();
  });

  test("should create agent in AVAILABLE state", () => {
    const agent = manager.createAgent("agent_1", "campaign_1");
    expect(agent.id).toBe("agent_1");
    expect(agent.state).toBe(AgentState.AVAILABLE);
    expect(agent.campaignId).toBe("campaign_1");
  });

  test("should get available agents", () => {
    manager.createAgent("agent_1", "campaign_1");
    manager.createAgent("agent_2", "campaign_1");
    manager.createAgent("agent_3", "campaign_2");

    const available = manager.getAvailableAgents("campaign_1");
    expect(available.length).toBe(2);
  });

  test("should reserve agent", async () => {
    manager.createAgent("agent_1", "campaign_1");
    const reservation = await manager.reserveAgent("agent_1", "call_1", "worker_1");
    
    expect(reservation).not.toBeNull();
    expect(reservation?.agentId).toBe("agent_1");
    expect(reservation?.callId).toBe("call_1");
    
    const agent = manager.getAgent("agent_1");
    expect(agent?.state).toBe(AgentState.RESERVED);
  });

  test("should not reserve already reserved agent", async () => {
    manager.createAgent("agent_1", "campaign_1");
    await manager.reserveAgent("agent_1", "call_1", "worker_1");
    
    const secondReservation = await manager.reserveAgent("agent_1", "call_2", "worker_2");
    expect(secondReservation).toBeNull();
  });

  test("should release agent to AVAILABLE", () => {
    manager.createAgent("agent_1", "campaign_1");
    manager.transitionState(manager.getAgent("agent_1")!, AgentState.RESERVED);
    
    const released = manager.releaseAgent("agent_1", AgentState.AVAILABLE);
    expect(released).toBe(true);
    
    const agent = manager.getAgent("agent_1");
    expect(agent?.state).toBe(AgentState.AVAILABLE);
  });

  test("should handle agent going offline", () => {
    manager.createAgent("agent_1", "campaign_1");
    manager.setAgentOffline("agent_1");
    
    const agent = manager.getAgent("agent_1");
    expect(agent?.state).toBe(AgentState.OFFLINE);
  });

  test("should transition agent through states", () => {
    manager.createAgent("agent_1", "campaign_1");
    const agent = manager.getAgent("agent_1")!;
    
    expect(manager.transitionState(agent, AgentState.RESERVED)).toBe(true);
    expect(agent.state).toBe(AgentState.RESERVED);
    
    expect(manager.transitionState(agent, AgentState.DIALING)).toBe(true);
    expect(agent.state).toBe(AgentState.DIALING);
    
    expect(manager.transitionState(agent, AgentState.CONNECTED)).toBe(true);
    expect(agent.state).toBe(AgentState.CONNECTED);
    
    expect(manager.transitionState(agent, AgentState.WRAP_UP)).toBe(true);
    expect(agent.state).toBe(AgentState.WRAP_UP);
  });

  test("should prevent invalid state transitions", () => {
    manager.createAgent("agent_1", "campaign_1");
    const agent = manager.getAgent("agent_1")!;
    
    // Cannot go directly from AVAILABLE to CONNECTED
    expect(manager.transitionState(agent, AgentState.CONNECTED)).toBe(false);
    expect(agent.state).toBe(AgentState.AVAILABLE);
  });
});
