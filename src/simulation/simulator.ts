import { DialerOrchestrator } from "../dialer/orchestrator";
import { ProviderA } from "../providers/providerA";
import { ProviderB } from "../providers/providerB";

interface SimulationConfig {
  mode: "progressive" | "predictive";
  agentCount: number;
  borrowerCount: number;
  answerRate: number;
  avgTalkTime: number;
  providerFailRate: number;
  durationSeconds: number;
  name: string;
}

interface SimulationResult {
  name: string;
  totalAgents: number;
  totalCallsInitiated: number;
  totalCallsConnected: number;
  totalCallsCompleted: number;
  totalCallsFailed: number;
  avgUtilization: number;
  avgWaitTime: number;
  safetyDecisions: {
    approved: number;
    reduced: number;
    rejected: number;
    fallbackToProgressive: number;
  };
}

export class Simulator {
  async runScenario(config: SimulationConfig): Promise<SimulationResult> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running scenario: ${config.name}`);
    console.log(
      `Mode: ${config.mode}, Agents: ${config.agentCount}, Answer Rate: ${
        config.answerRate * 100
      }%`
    );
    console.log(`${"=".repeat(60)}\n`);

    const orchestrator = new DialerOrchestrator();

    const providerA = new ProviderA();
    const providerB = new ProviderB({
      failureRate: config.providerFailRate,
      timeoutRate: config.providerFailRate * 0.5,
      duplicateRate: 0.05,
      outOfOrderRate: 0.1,
    });

    orchestrator.registerProvider(providerA);
    orchestrator.registerProvider(providerB);

    const borrowers = Array.from(
      { length: config.borrowerCount },
      (_, i) => `borrower_${i}`
    );
    const campaign = orchestrator.createCampaign({
      id: `campaign_${config.name.replace(/\s+/g, "_")}`,
      name: config.name,
      borrowerList: borrowers,
      mode: config.mode,
    });

    for (let i = 0; i < config.agentCount; i++) {
      orchestrator.addAgent(`agent_${i}`, campaign.id);
    }

    let totalInitiated = 0;
    let totalConnected = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    orchestrator.on("call:completed", () => totalCompleted++);
    orchestrator.on("call:failed", () => totalFailed++);

    orchestrator.on("call:transition", (data) => {
      if (data.state === "INITIATED") totalInitiated++;
      if (data.state === "CONNECTED") totalConnected++;
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
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const safetyMetrics = orchestrator.getSafetyMetrics();

    const result: SimulationResult = {
      name: config.name,
      totalAgents: config.agentCount,
      totalCallsInitiated: totalInitiated,
      totalCallsConnected: totalConnected,
      totalCallsCompleted: totalCompleted,
      totalCallsFailed: totalFailed,
      avgUtilization:
        (totalCompleted / (config.agentCount * config.durationSeconds)) * 120,
      avgWaitTime: 0,
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

  async runAllScenarios(): Promise<SimulationResult[]> {
    const scenarios: SimulationConfig[] = [
      {
        name: "Scenario A - Low Answer Rate (20%)",
        mode: "predictive",
        agentCount: 50,
        borrowerCount: 200,
        answerRate: 0.2,
        avgTalkTime: 120,
        providerFailRate: 0.05,
        durationSeconds: 20,
      },
      {
        name: "Scenario B - Medium Answer Rate (50%)",
        mode: "predictive",
        agentCount: 50,
        borrowerCount: 200,
        answerRate: 0.5,
        avgTalkTime: 90,
        providerFailRate: 0.1,
        durationSeconds: 20,
      },
      {
        name: "Scenario C - High Answer Rate (70%)",
        mode: "predictive",
        agentCount: 50,
        borrowerCount: 200,
        answerRate: 0.7,
        avgTalkTime: 180,
        providerFailRate: 0.05,
        durationSeconds: 20,
      },
      {
        name: "Scenario D - Provider Issues (30% fail)",
        mode: "predictive",
        agentCount: 50,
        borrowerCount: 200,
        answerRate: 0.5,
        avgTalkTime: 120,
        providerFailRate: 0.3,
        durationSeconds: 20,
      },
      {
        name: "Scenario E - Progressive Mode",
        mode: "progressive",
        agentCount: 50,
        borrowerCount: 200,
        answerRate: 0.5,
        avgTalkTime: 120,
        providerFailRate: 0.1,
        durationSeconds: 20,
      },
      {
        name: "Scenario F - High Volume Predictive",
        mode: "predictive",
        agentCount: 100,
        borrowerCount: 500,
        answerRate: 0.6,
        avgTalkTime: 60,
        providerFailRate: 0.05,
        durationSeconds: 20,
      },
    ];

    const results: SimulationResult[] = [];
    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario);
      results.push(result);
    }

    return results;
  }

  printResults(results: SimulationResult[]): void {
    console.log("\n" + "=".repeat(100));
    console.log("SIMULATION RESULTS");
    console.log("=".repeat(100));

    console.log(
      "\n" +
        "Scenario".padEnd(40) +
        "Agents".padEnd(10) +
        "Initiated".padEnd(12) +
        "Connected".padEnd(12) +
        "Completed".padEnd(12) +
        "Failed".padEnd(10) +
        "Approved".padEnd(10) +
        "Reduced".padEnd(10) +
        "Rejected".padEnd(10) +
        "Fallback".padEnd(10)
    );
    console.log("-".repeat(100));

    for (const result of results) {
      console.log(
        result.name.padEnd(40) +
          String(result.totalAgents).padEnd(10) +
          String(result.totalCallsInitiated).padEnd(12) +
          String(result.totalCallsConnected).padEnd(12) +
          String(result.totalCallsCompleted).padEnd(12) +
          String(result.totalCallsFailed).padEnd(10) +
          String(result.safetyDecisions.approved).padEnd(10) +
          String(result.safetyDecisions.reduced).padEnd(10) +
          String(result.safetyDecisions.rejected).padEnd(10) +
          String(result.safetyDecisions.fallbackToProgressive).padEnd(10)
      );
    }

    console.log("\n" + "=".repeat(100));
    console.log("ANALYSIS");
    console.log("=".repeat(100));

    const predictiveResults = results.filter((r) =>
      r.name.includes("Predictive")
    );
    const progressiveResults = results.filter((r) =>
      r.name.includes("Progressive")
    );

    if (predictiveResults.length > 0 && progressiveResults.length > 0) {
      const avgPredUtil =
        predictiveResults.reduce((a, b) => a + b.avgUtilization, 0) /
        predictiveResults.length;
      const avgProgUtil =
        progressiveResults.reduce((a, b) => a + b.avgUtilization, 0) /
        progressiveResults.length;

      console.log(
        `\nPredictive mode achieves ~${(
          ((avgPredUtil - avgProgUtil) / avgProgUtil) *
          100
        ).toFixed(1)}% higher utilization than progressive mode.`
      );
    }

    console.log("\nSafety Controller Behavior:");
    for (const result of results) {
      const totalDecisions =
        result.safetyDecisions.approved +
        result.safetyDecisions.reduced +
        result.safetyDecisions.rejected;
      if (totalDecisions > 0) {
        console.log(
          `  ${result.name}: ${result.safetyDecisions.rejected} rejected, ${result.safetyDecisions.reduced} reduced out of ${totalDecisions} total decisions`
        );
      }
    }
  }
}

if (require.main === module) {
  const simulator = new Simulator();
  simulator.runAllScenarios().then((results) => {
    simulator.printResults(results);
    process.exit(0);
  });
}
