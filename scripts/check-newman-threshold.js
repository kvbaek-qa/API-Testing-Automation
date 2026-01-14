// scripts/check-newman-threshold-cli.js
const fs = require("fs");

const logFile = process.argv[2];
const threshold = Number(process.argv[3] ?? 3);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf8");

// Newman summary 예시에서 failures 숫자 추출
const match = content.match(/failures:\s*(\d+)/i);

if (!match) {
  console.error("[FAIL] Could not find failure count in Newman output");
  process.exit(1);
}

const failureCount = Number(match[1]);

console.log(`Newman failure count: ${failureCount}`);
console.log(`Allowed max failures: ${threshold}`);

if (failureCount > threshold) {
  console.error(
    `[FAIL] Failure count (${failureCount}) exceeded threshold (${threshold})`
  );
  process.exit(1);
}

console.log("[PASS] Failure count is within threshold");
process.exit(0);
