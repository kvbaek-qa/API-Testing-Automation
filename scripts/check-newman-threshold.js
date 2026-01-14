// scripts/check-newman-threshold.js
const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const threshold = Number(process.argv[3] ?? 3);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf8");

// Newman CLI 출력에서 AssertionError 개수 세기
const matches = content.match(/AssertionError/gi);
const failureCount = matches ? matches.length : 0;

console.log(`Newman failure count (AssertionError): ${failureCount}`);
console.log(`Allowed max failures: ${threshold}`);

if (failureCount > threshold) {
  console.error(
    `[FAIL] Failure count (${failureCount}) exceeded threshold (${threshold}).`
  );
  process.exit(1);
}

console.log("[PASS] Failure count is within threshold.");
process.exit(0);
