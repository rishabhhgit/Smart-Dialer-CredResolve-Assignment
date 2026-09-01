import { DialerOrchestrator } from "../dialer/orchestrator";
import { ProviderA } from "../providers/providerA";
import { ProviderB } from "../providers/providerB";

interface LoadTestConfig {
  agentCount: number;
  durationSeconds: number;
  mode: "progressive" | "predictive";
  name: string;
}

export interface LoadTestResult {
  name: string;
  agentCount: number;
  totalCallsInitiated: number;
  totalCallsCompleted: number;
  totalCallsFailed: number;
  callsPerSecond: number;
  avgAgentUtilization: number;
  maxConcurrentCalls: number;
  safetyDecisions: {
    approved: number;
    reduced: number;
    rejected: number;
    fallbackToProgressive: number;
  };
}

export class LoadTester {
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Load Test: ${config.name}`);
    console.log(
      `Agents: ${config.agentCount}, Mode: ${config.mode}, Duration: ${config.durationSeconds}s`
    );
    console.log(`${"=".repeat(60)}\n`);

    const orchestrator = new DialerOrchestrator();

    orchestrator.registerProvider(new ProviderA());
    orchestrator.registerProvider(new ProviderB());

    const borrowers = Array.from(
      { length: config.agentCount * 5 },
      (_, i) => `borrower_${i}`
    );
    const campaign = orchestrator.createCampaign({
      id: `load_test_${config.agentCount}_${config.mode}`,
      name: config.name,
      borrowerList: borrowers,
      mode: config.mode,
    });

    for (let i = 0; i < config.agentCount; i++) {
      orchestrator.addAgent(`agent_${i}`, campaign.id);
    }

    let totalInitiated = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    orchestrator.on("call:completed", () => {
      totalCompleted++;
      currentConcurrent--;
    });

    orchestrator.on("call:failed", () => {
      totalFailed++;
      currentConcurrent--;
    });

    orchestrator.on("call:transition", (data: any) => {
      if (data.state === "INITIATED") {
        totalInitiated++;
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      }
    });

    const startTime = Date.now();
    orchestrator.startPacing(campaign.id, 500);

    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= config.durationSeconds * 1000) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });

    orchestrator.stopPacing(campaign.id);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const safetyMetrics = orchestrator.getSafetyMetrics();

    const result: LoadTestResult = {
      name: config.name,
      agentCount: config.agentCount,
      totalCallsInitiated: totalInitiated,
      totalCallsCompleted: totalCompleted,
      totalCallsFailed: totalFailed,
      callsPerSecond: totalInitiated / config.durationSeconds,
      avgAgentUtilization:
        (totalCompleted / (config.agentCount * config.durationSeconds)) * 120,
      maxConcurrentCalls: maxConcurrent,
      safetyDecisions: {
        approved: safetyMetrics.approved,
        reduced: safetyMetrics.reduced,
        rejected: safetyMetrics.rejected,
        fallbackToProgressive: safetyMetrics.fallbackToProgressive,
      },
    };

    await orchestrator.shutdown();
    return result;
  }

  async runAllTests(): Promise<LoadTestResult[]> {
    const configs: LoadTestConfig[] = [
      {
        agentCount: 50,
        durationSeconds: 15,
        mode: "progressive",
        name: "50 Agents Progressive",
      },
      {
        agentCount: 50,
        durationSeconds: 15,
        mode: "predictive",
        name: "50 Agents Predictive",
      },
      {
        agentCount: 200,
        durationSeconds: 15,
        mode: "progressive",
        name: "200 Agents Progressive",
      },
      {
        agentCount: 200,
        durationSeconds: 15,
        mode: "predictive",
        name: "200 Agents Predictive",
      },
      {
        agentCount: 500,
        durationSeconds: 15,
        mode: "progressive",
        name: "500 Agents Progressive",
      },
      {
        agentCount: 500,
        durationSeconds: 15,
        mode: "predictive",
        name: "500 Agents Predictive",
      },
    ];

    const results: LoadTestResult[] = [];
    for (const config of configs) {
      const result = await this.runLoadTest(config);
      results.push(result);
    }

    return results;
  }

  printResults(results: LoadTestResult[]): void {
    console.log("\n" + "=".repeat(100));
    console.log("LOAD TEST RESULTS");
    console.log("=".repeat(100));

    console.log(
      "\n" +
        "Name".padEnd(30) +
        "Agents".padEnd(10) +
        "Initiated".padEnd(12) +
        "Completed".padEnd(12) +
        "Failed".padEnd(10) +
        "Calls/s".padEnd(10) +
        "Max Concurrent".padEnd(16) +
        "Approved".padEnd(10) +
        "Reduced".padEnd(10) +
        "Rejected".padEnd(10)
    );
    console.log("-".repeat(100));

    for (const result of results) {
      console.log(
        result.name.padEnd(30) +
          String(result.agentCount).padEnd(10) +
          String(result.totalCallsInitiated).padEnd(12) +
          String(result.totalCallsCompleted).padEnd(12) +
          String(result.totalCallsFailed).padEnd(10) +
          result.callsPerSecond.toFixed(1).padEnd(10) +
          String(result.maxConcurrentCalls).padEnd(16) +
          String(result.safetyDecisions.approved).padEnd(10) +
          String(result.safetyDecisions.reduced).padEnd(10) +
          String(result.safetyDecisions.rejected).padEnd(10)
      );
    }

    console.log("\n" + "=".repeat(100));
    console.log("SCALE ANALYSIS");
    console.log("=".repeat(100));
    console.log(`
At 10,000 agents, the following bottlenecks emerge:

1. IN-MEMORY STATE (First to break):
   - Current: All agent/call state in JavaScript Maps
   - Problem: Single process memory limit (~4GB for Node.js)
   - Impact: Can hold ~50,000 agents before memory pressure
   - Fix: Shard state across Redis cluster, partition by campaign

2. SINGLE EVENT LOOP (Second to break):
   - Current: All provider events processed on one thread
   - Problem: Event processing latency increases with call volume
   - Impact: At 10K agents with 50% utilization, ~5,000 concurrent calls
     generate ~15,000 events/minute (RINGING + ANSWERED + COMPLETED)
   - Fix: Worker pool for event processing, separate event ingestion

3. LOCK CONTENTION (Third to break):
   - Current: Per-agent async locks in single process
   - Problem: Multiple pacing cycles compete for same agents
   - Impact: Increased latency, potential deadlocks under high contention
   - Fix: Distributed locks (Redis Redlock) with lease timeouts

4. PROVIDER CONNECTION LIMITS (Fourth to break):
   - Current: Each provider maintains single connection
   - Problem: Telecom providers have concurrent call limits
   - Impact: Provider throttling, increased failure rates
   - Fix: Connection pooling per provider, load balancing across providers

PROPOSED FIX PATH:
Phase 1 (1K agents): Add Redis for agent state, keep single orchestrator
Phase 2 (5K agents): Shard by campaign, each campaign gets own orchestrator
Phase 3 (10K+ agents): Event-driven architecture with Kafka for provider events
    `);
  }
}
