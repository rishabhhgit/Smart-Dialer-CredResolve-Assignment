import { LoadTester, LoadTestResult } from "../src/engine/loadTester";

// Re-export for backwards compatibility
export { LoadTester, LoadTestResult };

// Run if called directly
if (require.main === module) {
  const tester = new LoadTester();
  tester.runAllTests().then((results) => {
    tester.printResults(results);
    process.exit(0);
  });
}
