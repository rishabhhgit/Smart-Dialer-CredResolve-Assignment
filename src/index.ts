import { DialerOrchestrator } from "./dialer/orchestrator";
import { ProviderA } from "./providers/providerA";
import { ProviderB } from "./providers/providerB";
import { Simulator } from "./simulation/simulator";
import { MultiWorkerSimulator } from "./dialer/multiWorker";
import { LoadTester } from "./engine/loadTester";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "demo";

  switch (command) {
    case "demo":
      await runDemo();
      break;
    case "simulate":
      await runSimulation();
      break;
    case "loadtest":
      await runLoadTest();
      break;
    case "multiworker":
      await runMultiWorkerTest();
      break;
    case "failures":
      await runFailureScenarios();
      break;
    case "all":
      await runAll();
      break;
    default:
      console.log("Usage: npm start [demo|simulate|loadtest|multiworker|failures|all]");
  }
}

async function runDemo() {
  console.log("SmartDialer Demo\n");

  const orchestrator = new DialerOrchestrator();

  orchestrator.registerProvider(new ProviderA());
  orchestrator.registerProvider(new ProviderB());

  const borrowers = Array.from({ length: 100 }, (_, i) => `borrower_${i}`);
  const campaign = orchestrator.createCampaign({
    id: "demo_campaign",
    name: "Demo Campaign",
    borrowerList: borrowers,
    mode: "predictive",
  });

  for (let i = 0; i < 20; i++) {
    orchestrator.addAgent(`agent_${i}`, campaign.id);
  }

  orchestrator.on("call:completed", (data) => {
    console.log(`  Call completed: ${data.callId}`);
  });

  orchestrator.on("call:failed", (data) => {
    console.log(`  Call failed: ${data.callId} - ${data.reason}`);
  });

  orchestrator.on("safety:rejected", (data) => {
    console.log(`  Safety rejected: ${data.reason}`);
  });

  console.log("Starting dialer...");
  orchestrator.startPacing(campaign.id, 1000);

  await new Promise((resolve) => setTimeout(resolve, 20000));

  orchestrator.stopPacing(campaign.id);
  console.log("\nStopping dialer...");

  const safetyMetrics = orchestrator.getSafetyMetrics();
  console.log("\nSafety Metrics:", JSON.stringify(safetyMetrics, null, 2));

  await orchestrator.shutdown();
}

async function runSimulation() {
  const simulator = new Simulator();
  const results = await simulator.runAllScenarios();
  simulator.printResults(results);
}

async function runLoadTest() {
  const tester = new LoadTester();
  const results = await tester.runAllTests();
  tester.printResults(results);
}

async function runMultiWorkerTest() {
  const simulator = new MultiWorkerSimulator();

  console.log("=".repeat(60));
  console.log("MULTI-WORKER CONCURRENCY TEST");
  console.log("=".repeat(60));

  const concurrencyResult = await simulator.runConcurrencyTest(5, 50, 10);
  simulator.printResults(concurrencyResult);

  console.log("\n" + "=".repeat(60));
  console.log("CRASH RECOVERY TEST");
  console.log("=".repeat(60));

  const crashResult = await simulator.runCrashRecoveryTest(10);
  console.log(`Crashed: ${crashResult.crashed}`);
  console.log(`Recovered: ${crashResult.recovered}`);
  console.log(`Calls after recovery: ${crashResult.callsAfterRecovery}`);

  console.log("\n" + "=".repeat(60));
  console.log("PROVIDER OUTAGE TEST");
  console.log("=".repeat(60));

  const outageResult = await simulator.runProviderOutageTest(5);
  console.log(`Outage detected: ${outageResult.outageDetected}`);
  console.log(`Calls during outage (failed): ${outageResult.callsDuringOutage}`);
  console.log(`Calls after recovery: ${outageResult.callsAfterRecovery}`);

  console.log("\n" + "=".repeat(60));
  console.log("AGENT AVAILABILITY DROP TEST");
  console.log("=".repeat(60));

  const dropResult = await simulator.runAgentDropTest(50, 40, 5);
  console.log(`Initial agents: ${dropResult.initialAgentCount}`);
  console.log(`Agents after drop: ${dropResult.agentsAfterDrop}`);
  console.log(`Pacing reduced: ${dropResult.pacingReduced}`);
}

async function runFailureScenarios() {
  console.log("=".repeat(60));
  console.log("FAILURE SCENARIO DEMONSTRATIONS");
  console.log("=".repeat(60));

  const orchestrator = new DialerOrchestrator();
  orchestrator.registerProvider(new ProviderA());
  orchestrator.registerProvider(new ProviderB());

  const borrowers = Array.from({ length: 50 }, (_, i) => `borrower_${i}`);
  const campaign = orchestrator.createCampaign({
    id: "failure_test",
    name: "Failure Test",
    borrowerList: borrowers,
    mode: "predictive",
  });

  for (let i = 0; i < 20; i++) {
    orchestrator.addAgent(`agent_${i}`, campaign.id);
  }

  console.log("\n1. Starting dialer...");
  orchestrator.startPacing(campaign.id, 500);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("\n2. Simulating provider outage...");
  const providers = orchestrator.getProviderHealth();
  for (const [name, _] of Object.entries(providers)) {
    orchestrator.setProviderHealth(name, false);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("\n3. Restoring providers...");
  for (const [name, _] of Object.entries(providers)) {
    orchestrator.setProviderHealth(name, true);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("\n4. Dropping 15 agents...");
  for (let i = 0; i < 15; i++) {
    orchestrator.removeAgent(`agent_${i}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log("\n5. Final metrics:");
  const metrics = orchestrator.getSafetyMetrics();
  console.log(JSON.stringify(metrics, null, 2));

  orchestrator.stopPacing(campaign.id);
  await orchestrator.shutdown();
}

async function runAll() {
  console.log("Running all tests...\n");

  console.log("1. DEMO");
  console.log("-".repeat(40));
  await runDemo();

  console.log("\n\n2. SIMULATION");
  console.log("-".repeat(40));
  await runSimulation();

  console.log("\n\n3. MULTI-WORKER TEST");
  console.log("-".repeat(40));
  await runMultiWorkerTest();

  console.log("\n\n4. FAILURE SCENARIOS");
  console.log("-".repeat(40));
  await runFailureScenarios();

  console.log("\n\n5. LOAD TEST");
  console.log("-".repeat(40));
  await runLoadTest();
}

main().catch(console.error);
