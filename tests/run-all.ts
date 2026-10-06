// Test runner — executes every *-test.ts suite in a separate process
// and reports a consolidated result. Used by `npm test`.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(testsDir)
  .filter(f => f.endsWith("-test.ts"))
  .sort();

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(testsDir, suite)],
    { stdio: "pipe", encoding: "utf-8" }
  );
  const okSuite = result.status === 0;
  if (okSuite) {
    passed++;
    console.log(`  PASS  ${suite}`);
  } else {
    failed++;
    failures.push(suite);
    console.log(`  FAIL  ${suite}`);
    const tail = (result.stdout || "").split("\n").slice(-6).join("\n");
    const err = (result.stderr || "").split("\n").slice(-6).join("\n");
    console.log(`    ${tail}\n    ${err}`);
  }
}

console.log(`\n${passed}/${suites.length} suites passed · ${failed} failed\n`);
if (failed > 0) {
  console.log(`Failed suites: ${failures.join(", ")}`);
  process.exit(1);
}
