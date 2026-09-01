import { AgentManager, AgentState } from "../src/models/agent";
import { CallManager, CallState } from "../src/models/call";
import { SafetyController } from "../src/safety/controller";
import { SharedStateManager } from "../src/dialer/sharedState";
import { InMemoryDatabase, CrashRecoveryManager } from "../src/persistence/database";
import { IdempotencyManager } from "../src/providers/idempotency";
import { ProviderCallEvent } from "../src/providers/types";

interface BenchmarkResult {
  name: string;
  operationsPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  totalOperations: number;
  durationMs: number;
}

describe("Performance Benchmarks", () => {
  test("AgentManager: create 1000 agents", () => {
    const manager = new AgentManager();
    const start = Date.now();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      manager.createAgent(`agent_${i}`, "campaign_1");
    }

    const duration = Date.now() - start;
    const opsPerSecond = (count / duration) * 1000;

    console.log(`AgentManager.create: ${opsPerSecond.toFixed(0)} ops/sec (${duration}ms for ${count})`);
    expect(opsPerSecond).toBeGreaterThan(1000);
  });

  test("AgentManager: reserve 500 agents concurrently", async () => {
    const manager = new AgentManager();
    for (let i = 0; i < 500; i++) {
      manager.createAgent(`agent_${i}`, "campaign_1");
    }

    const start = Date.now();
    const promises = [];

    for (let i = 0; i < 500; i++) {
      promises.push(manager.reserveAgent(`agent_${i}`, `call_${i}`, "worker_1"));
    }

    const results = await Promise.all(promises);
    const duration = Date.now() - start;
    const successCount = results.filter((r) => r !== null).length;

    console.log(`AgentManager.reserve (500 concurrent): ${duration}ms, ${successCount} reserved`);
    expect(successCount).toBe(500);
  });

  test("CallManager: create and transition 1000 calls", async () => {
    const manager = new CallManager();
    const start = Date.now();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      const call = manager.createCall("campaign_1", `borrower_${i}`);
      await manager.transitionCall(call.id, CallState.RESERVED);
      await manager.transitionCall(call.id, CallState.INITIATED);
      await manager.transitionCall(call.id, CallState.RINGING);
      await manager.transitionCall(call.id, CallState.ANSWERED);
      await manager.transitionCall(call.id, CallState.CONNECTED);
      await manager.transitionCall(call.id, CallState.COMPLETED);
    }

    const duration = Date.now() - start;
    const opsPerSecond = ((count * 6) / duration) * 1000;

    console.log(`CallManager.transition: ${opsPerSecond.toFixed(0)} ops/sec (${duration}ms for ${count * 6} transitions)`);
    expect(opsPerSecond).toBeGreaterThan(5000);
  });

  test("SafetyController: evaluate 10000 decisions", () => {
    const controller = new SafetyController();
    const start = Date.now();
    const count = 10000;

    for (let i = 0; i < count; i++) {
      controller.evaluatePacing(
        { campaignId: "c1", requestedCalls: 10, reason: "test" },
        {
          availableAgents: 50,
          activeCalls: 10,
          connectedCalls: 8,
          ringingCalls: 2,
          failedCallsLast5Min: 0,
          totalCallsLast5Min: 20,
          providerHealth: { providerA: true },
          avgAnswerRate: 0.5,
          avgCallDuration: 120,
        }
      );
    }

    const duration = Date.now() - start;
    const opsPerSecond = (count / duration) * 1000;

    console.log(`SafetyController.evaluate: ${opsPerSecond.toFixed(0)} ops/sec (${duration}ms for ${count})`);
    expect(opsPerSecond).toBeGreaterThan(10000);
  });

  test("SharedStateManager: 100 concurrent reservations", async () => {
    const sharedState = new SharedStateManager();
    const agentManager = new AgentManager();

    for (let i = 0; i < 100; i++) {
      const agent = agentManager.createAgent(`agent_${i}`, "campaign_1");
      sharedState.registerAgent(agent);
    }

    const start = Date.now();
    const promises = [];

    for (let i = 0; i < 100; i++) {
      promises.push(
        sharedState.tryReserveAgent(`agent_${i}`, `call_${i}`, `worker_${i % 5}`)
      );
    }

    const results = await Promise.all(promises);
    const duration = Date.now() - start;
    const successCount = results.filter((r) => r === true).length;

    console.log(`SharedStateManager.reserve (100 concurrent): ${duration}ms, ${successCount} reserved`);
    expect(successCount).toBe(100);
  });

  test("InMemoryDatabase: save and load 5000 records", () => {
    const db = new InMemoryDatabase();
    const start = Date.now();
    const count = 5000;

    for (let i = 0; i < count; i++) {
      db.save("agent", `agent_${i}`, { id: `agent_${i}`, state: "AVAILABLE" });
    }

    const saveDuration = Date.now() - start;

    const loadStart = Date.now();
    for (let i = 0; i < count; i++) {
      db.load(`agent_${i}`);
    }
    const loadDuration = Date.now() - loadStart;

    const totalOps = count * 2;
    const totalDuration = saveDuration + loadDuration;
    const opsPerSecond = (totalOps / totalDuration) * 1000;

    console.log(`InMemoryDatabase: save ${saveDuration}ms, load ${loadDuration}ms, ${opsPerSecond.toFixed(0)} ops/sec`);
    expect(opsPerSecond).toBeGreaterThan(50000);
  });

  test("IdempotencyManager: check 10000 events", () => {
    const manager = new IdempotencyManager();
    const start = Date.now();
    const count = 10000;

    for (let i = 0; i < count; i++) {
      const event: ProviderCallEvent = {
        providerCallId: `PLIVO_${i}`,
        callId: `call_${i}`,
        status: "ANSWERED",
        timestamp: Date.now(),
      };

      const isDuplicate = manager.isDuplicate(event);
      if (!isDuplicate) {
        manager.markProcessed(event, "accepted");
      }
    }

    const duration = Date.now() - start;
    const opsPerSecond = (count / duration) * 1000;

    console.log(`IdempotencyManager: ${opsPerSecond.toFixed(0)} ops/sec (${duration}ms for ${count})`);
    expect(opsPerSecond).toBeGreaterThan(5000);
    manager.stop();
  });

  test("CrashRecoveryManager: checkpoint and recover", () => {
    const db = new InMemoryDatabase();
    const recovery = new CrashRecoveryManager(db);

    for (let i = 0; i < 1000; i++) {
      db.save("agent", `agent_${i}`, { id: `agent_${i}`, state: "AVAILABLE" });
    }

    db.save("campaign", "campaign_1", { id: "campaign_1", name: "Test" });

    const start = Date.now();
    recovery.checkpoint();
    const checkpointDuration = Date.now() - start;

    db.clear();
    db.save("campaign", "campaign_1", { id: "campaign_1", name: "Test" });

    const recoverStart = Date.now();
    const result = recovery.recoverFromCrash();
    const recoverDuration = Date.now() - recoverStart;

    console.log(`CrashRecovery: checkpoint ${checkpointDuration}ms, recover ${recoverDuration}ms`);
    expect(result.recordsRecovered).toBeGreaterThan(0);
  });
});

describe("Concurrency Benchmarks", () => {
  test("5 workers competing for 100 agents", async () => {
    const sharedState = new SharedStateManager();
    const agentManager = new AgentManager();

    for (let i = 0; i < 100; i++) {
      const agent = agentManager.createAgent(`agent_${i}`, "campaign_1");
      sharedState.registerAgent(agent);
    }

    const start = Date.now();
    const allPromises: Promise<boolean>[] = [];

    for (let worker = 0; worker < 5; worker++) {
      for (let i = 0; i < 20; i++) {
        allPromises.push(
          sharedState.tryReserveAgent(
            `agent_${worker * 20 + i}`,
            `call_${worker}_${i}`,
            `worker_${worker}`
          )
        );
      }
    }

    const results = await Promise.all(allPromises);
    const duration = Date.now() - start;
    const successCount = results.filter((r) => r === true).length;

    console.log(`5 workers, 100 agents: ${duration}ms, ${successCount} reserved`);
    expect(successCount).toBe(100);
  });

  test("100 concurrent state transitions", async () => {
    const callManager = new CallManager();
    const calls = [];

    for (let i = 0; i < 100; i++) {
      calls.push(callManager.createCall("campaign_1", `borrower_${i}`));
    }

    const start = Date.now();
    const promises = calls.map(async (call) => {
      await callManager.transitionCall(call.id, CallState.RESERVED);
      await callManager.transitionCall(call.id, CallState.INITIATED);
      await callManager.transitionCall(call.id, CallState.RINGING);
      await callManager.transitionCall(call.id, CallState.ANSWERED);
      await callManager.transitionCall(call.id, CallState.CONNECTED);
      await callManager.transitionCall(call.id, CallState.COMPLETED);
    });

    await Promise.all(promises);
    const duration = Date.now() - start;

    console.log(`100 concurrent call transitions: ${duration}ms`);
    expect(duration).toBeLessThan(5000);
  });
});
