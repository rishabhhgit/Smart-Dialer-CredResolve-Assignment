import { CallManager, CallState } from "../src/models/call";

describe("CallManager", () => {
  let manager: CallManager;

  beforeEach(() => {
    manager = new CallManager();
  });

  test("should create call in QUEUED state", () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    expect(call.state).toBe(CallState.QUEUED);
    expect(call.campaignId).toBe("campaign_1");
    expect(call.borrowerId).toBe("borrower_1");
  });

  test("should get queued calls", () => {
    manager.createCall("campaign_1", "borrower_1");
    manager.createCall("campaign_1", "borrower_2");
    manager.createCall("campaign_2", "borrower_3");

    const queued = manager.getQueuedCalls("campaign_1");
    expect(queued.length).toBe(2);
  });

  test("should transition call through states", async () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    
    await manager.transitionCall(call.id, CallState.RESERVED);
    expect(manager.getCall(call.id)?.state).toBe(CallState.RESERVED);
    
    await manager.transitionCall(call.id, CallState.INITIATED);
    expect(manager.getCall(call.id)?.state).toBe(CallState.INITIATED);
    
    await manager.transitionCall(call.id, CallState.RINGING);
    expect(manager.getCall(call.id)?.state).toBe(CallState.RINGING);
    
    await manager.transitionCall(call.id, CallState.ANSWERED);
    expect(manager.getCall(call.id)?.state).toBe(CallState.ANSWERED);
    
    await manager.transitionCall(call.id, CallState.CONNECTED);
    expect(manager.getCall(call.id)?.state).toBe(CallState.CONNECTED);
  });

  test("should handle call completion", async () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    await manager.transitionCall(call.id, CallState.RESERVED);
    await manager.transitionCall(call.id, CallState.INITIATED);
    await manager.transitionCall(call.id, CallState.RINGING);
    await manager.transitionCall(call.id, CallState.ANSWERED);
    await manager.transitionCall(call.id, CallState.CONNECTED);
    await manager.transitionCall(call.id, CallState.COMPLETED);
    
    expect(manager.getCall(call.id)?.state).toBe(CallState.COMPLETED);
  });

  test("should handle call failure", async () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    await manager.transitionCall(call.id, CallState.RESERVED);
    await manager.transitionCall(call.id, CallState.INITIATED);
    await manager.transitionCall(call.id, CallState.FAILED, "TIMEOUT");
    
    expect(manager.getCall(call.id)?.state).toBe(CallState.FAILED);
    const history = manager.getCall(call.id)?.stateHistory;
    expect(history).toBeDefined();
    expect(history!.length).toBe(4); // QUEUED, RESERVED, INITIATED, FAILED
    expect(history![3].reason).toBe("TIMEOUT");
  });

  test("should assign agent to call", () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    const assigned = manager.assignAgent(call.id, "agent_1");
    
    expect(assigned).toBe(true);
    expect(manager.getCall(call.id)?.agentId).toBe("agent_1");
  });

  test("should track state history", async () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    await manager.transitionCall(call.id, CallState.RESERVED);
    await manager.transitionCall(call.id, CallState.INITIATED);
    
    const history = manager.getCall(call.id)?.stateHistory;
    expect(history?.length).toBe(3);
    expect(history?.[0].state).toBe(CallState.QUEUED);
    expect(history?.[1].state).toBe(CallState.RESERVED);
    expect(history?.[2].state).toBe(CallState.INITIATED);
  });

  test("should not allow invalid transitions", async () => {
    const call = manager.createCall("campaign_1", "borrower_1");
    
    // Cannot go directly from QUEUED to CONNECTED
    const result = await manager.transitionCall(call.id, CallState.CONNECTED);
    expect(result).toBe(false);
    expect(manager.getCall(call.id)?.state).toBe(CallState.QUEUED);
  });
});
