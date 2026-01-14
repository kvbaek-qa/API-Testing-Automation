// scripts/check-newman-threshold.js
const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const threshold = Number(process.argv[3] ?? 3);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf8");

// Newman CLI summary는 보통 표 형태로 나옴 (│ failures │ 1 │)
// 환경에 따라 포맷이 조금 달라질 수 있어서 여러 패턴을 허용
const patterns = [
  /failures\s*:\s*(\d+)/i,                 // "failures: 2"
  /failures[^0-9]*([0-9]+)/i,              // "failures ... 2" (표/기타)
  /\bfailures\b.*?(\d+)\b/i,               // 보수적으로
];

let failureCount = null;
for (const p of patterns) {
  const m = content.match(p);
  if (m && m[1] !== undefined) {
    failureCount = Number(m[1]);
    if (!Number.isNaN(failureCount)) break;
  }
}

if (failureCount === null) {
  console.error("[FAIL] Could not find failure count in Newman output.");
  console.error("Hint: check report/newman.log and search for the word 'failures'.");
  process.exit(1);
}

console.log(`Newman failure count: ${failureCount}`);
console.log(`Allowed max failures: ${threshold}`);

if (failureCount > threshold) {
  console.error(`[FAIL] Failure count (${failureCount}) exceeded threshold (${threshold}).`);
  process.exit(1);
}

console.log("[PASS] Failure count is within threshold.");
process.exit(0);
