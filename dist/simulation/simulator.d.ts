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
export declare class Simulator {
    runScenario(config: SimulationConfig): Promise<SimulationResult>;
    runAllScenarios(): Promise<SimulationResult[]>;
    printResults(results: SimulationResult[]): void;
}
export {};
//# sourceMappingURL=simulator.d.ts.map