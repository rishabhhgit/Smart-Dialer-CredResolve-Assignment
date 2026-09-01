"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Simulator = void 0;
const orchestrator_1 = require("../dialer/orchestrator");
const providerA_1 = require("../providers/providerA");
const providerB_1 = require("../providers/providerB");
class Simulator {
    async runScenario(config) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Running scenario: ${config.name}`);
        console.log(`Mode: ${config.mode}, Agents: ${config.agentCount}, Answer Rate: ${config.answerRate * 100}%`);
        console.log(`${"=".repeat(60)}\n`);
        const orchestrator = new orchestrator_1.DialerOrchestrator();
        // Set up providers
        const providerA = new providerA_1.ProviderA();
        const providerB = new providerB_1.ProviderB({
            failureRate: config.providerFailRate,
            timeoutRate: config.providerFailRate * 0.5,
            duplicateRate: 0.05,
            outOfOrderRate: 0.1,
        });
        orchestrator.registerProvider(providerA);
        orchestrator.registerProvider(providerB);
        // Create campaign
        const borrowers = Array.from({ length: config.borrowerCount }, (_, i) => `borrower_${i}`);
        const campaign = orchestrator.createCampaign({
            id: `campaign_${config.name}`,
            name: config.name,
            borrowerList: borrowers,
            mode: config.mode,
        });
        // Add agents
        for (let i = 0; i < config.agentCount; i++) {
            orchestrator.addAgent(`agent_${i}`, campaign.id);
        }
        // Track metrics
        let totalInitiated = 0;
        let totalConnected = 0;
        let totalCompleted = 0;
        let totalFailed = 0;
        orchestrator.on("call:completed", () => totalCompleted++);
        orchestrator.on("call:failed", () => totalFailed++);
        // Start pacing
        orchestrator.startPacing(campaign.id, 500);
        // Run for specified duration
        const startTime = Date.now();
        const durationMs = config.durationSeconds * 1000;
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed >= durationMs) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
        // Stop pacing
        orchestrator.stopPacing(campaign.id);
        // Wait for remaining calls to complete
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // Collect results
        const safetyMetrics = orchestrator.getSafetyMetrics();
        const result = {
            name: config.name,
            totalAgents: config.agentCount,
            totalCallsInitiated: totalInitiated,
            totalCallsConnected: totalConnected,
            totalCallsCompleted: totalCompleted,
            totalCallsFailed: totalFailed,
            avgUtilization: totalCompleted / (config.agentCount * config.durationSeconds) * 120,
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
    async runAllScenarios() {
        const scenarios = [
            {
                name: "Scenario A - Low Answer Rate",
                mode: "predictive",
                agentCount: 50,
                borrowerCount: 100,
                answerRate: 0.2,
                avgTalkTime: 120,
                providerFailRate: 0.05,
                durationSeconds: 30,
            },
            {
                name: "Scenario B - Medium Answer Rate",
                mode: "predictive",
                agentCount: 50,
                borrowerCount: 100,
                answerRate: 0.5,
                avgTalkTime: 90,
                providerFailRate: 0.1,
                durationSeconds: 30,
            },
            {
                name: "Scenario C - High Answer Rate",
                mode: "predictive",
                agentCount: 50,
                borrowerCount: 100,
                answerRate: 0.7,
                avgTalkTime: 180,
                providerFailRate: 0.05,
                durationSeconds: 30,
            },
            {
                name: "Scenario D - Provider Issues",
                mode: "predictive",
                agentCount: 50,
                borrowerCount: 100,
                answerRate: 0.5,
                avgTalkTime: 120,
                providerFailRate: 0.3,
                durationSeconds: 30,
            },
            {
                name: "Scenario E - Progressive Mode",
                mode: "progressive",
                agentCount: 50,
                borrowerCount: 100,
                answerRate: 0.5,
                avgTalkTime: 120,
                providerFailRate: 0.1,
                durationSeconds: 30,
            },
        ];
        const results = [];
        for (const scenario of scenarios) {
            const result = await this.runScenario(scenario);
            results.push(result);
        }
        return results;
    }
    printResults(results) {
        console.log("\n" + "=".repeat(80));
        console.log("SIMULATION RESULTS");
        console.log("=".repeat(80));
        for (const result of results) {
            console.log(`\n--- ${result.name} ---`);
            console.log(`  Total Agents: ${result.totalAgents}`);
            console.log(`  Calls Completed: ${result.totalCallsCompleted}`);
            console.log(`  Calls Failed: ${result.totalCallsFailed}`);
            console.log(`  Safety Decisions:`);
            console.log(`    - Approved: ${result.safetyDecisions.approved}`);
            console.log(`    - Reduced: ${result.safetyDecisions.reduced}`);
            console.log(`    - Rejected: ${result.safetyDecisions.rejected}`);
            console.log(`    - Fallback to Progressive: ${result.safetyDecisions.fallbackToProgressive}`);
        }
    }
}
exports.Simulator = Simulator;
// Run simulation if called directly
if (require.main === module) {
    const simulator = new Simulator();
    simulator.runAllScenarios().then((results) => {
        simulator.printResults(results);
        process.exit(0);
    });
}
//# sourceMappingURL=simulator.js.map