"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("./dialer/orchestrator");
const providerA_1 = require("./providers/providerA");
const providerB_1 = require("./providers/providerB");
const simulator_1 = require("./simulation/simulator");
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
        default:
            console.log("Usage: npm start [demo|simulate|loadtest]");
    }
}
async function runDemo() {
    console.log("SmartDialer Demo\n");
    const orchestrator = new orchestrator_1.DialerOrchestrator();
    // Set up providers
    orchestrator.registerProvider(new providerA_1.ProviderA());
    orchestrator.registerProvider(new providerB_1.ProviderB());
    // Create campaign
    const borrowers = Array.from({ length: 100 }, (_, i) => `borrower_${i}`);
    const campaign = orchestrator.createCampaign({
        id: "demo_campaign",
        name: "Demo Campaign",
        borrowerList: borrowers,
        mode: "predictive",
    });
    // Add agents
    for (let i = 0; i < 20; i++) {
        orchestrator.addAgent(`agent_${i}`, campaign.id);
    }
    // Listen to events
    orchestrator.on("call:completed", (data) => {
        console.log(`Call completed: ${data.callId}`);
    });
    orchestrator.on("call:failed", (data) => {
        console.log(`Call failed: ${data.callId} - ${data.reason}`);
    });
    orchestrator.on("safety:rejected", (data) => {
        console.log(`Safety rejected: ${data.reason}`);
    });
    // Start pacing
    console.log("Starting dialer...");
    orchestrator.startPacing(campaign.id, 1000);
    // Run for 30 seconds
    await new Promise((resolve) => setTimeout(resolve, 30000));
    // Stop and get metrics
    orchestrator.stopPacing(campaign.id);
    console.log("\nStopping dialer...");
    const safetyMetrics = orchestrator.getSafetyMetrics();
    console.log("\nSafety Metrics:", safetyMetrics);
    await orchestrator.shutdown();
}
async function runSimulation() {
    const simulator = new simulator_1.Simulator();
    const results = await simulator.runAllScenarios();
    simulator.printResults(results);
}
async function runLoadTest() {
    console.log("Load test is available via: npm run start:loadtest (in tests folder)");
}
main().catch(console.error);
//# sourceMappingURL=index.js.map