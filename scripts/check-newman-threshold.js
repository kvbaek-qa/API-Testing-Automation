// scripts/check-newman-threshold.js
// 목적:
// 1) newman.log에서 AssertionError 개수 집계
// 2) threshold 초과 시 CI fail
// 3) GitHub Actions에서 재사용 가능한 output 제공

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const threshold = Number(process.argv[3] ?? 3);

// GitHub Actions 환경 여부
const isGithubActions = !!process.env.GITHUB_OUTPUT;

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf8");

// AssertionError 개수 집계
const matches = content.match(/AssertionError/gi);
const failureCount = matches ? matches.length : 0;

// 로그 출력 (사람용)
console.log(`Newman failure count (AssertionError): ${failureCount}`);
console.log(`Allowed max failures: ${threshold}`);

// GitHub Actions output으로도 제공 (기계용)
if (isGithubActions) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `failure_count=${failureCount}\nthreshold=${threshold}\n`
  );
}

// threshold 판정
if (failureCount > threshold) {
  console.error(
    `[FAIL] Failure count (${failureCount}) exceeded threshold (${threshold}).`
  );
  process.exit(1);
}

console.log("[PASS] Failure count is within threshold.");
process.exit(0);
