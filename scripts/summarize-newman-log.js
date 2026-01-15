// scripts/summarize-newman-log.js
// report/newman.log에서 AssertionError 발생 시
// - 어떤 Request(API)가 실패했는지
// - 어떤 Assertion(test)이 실패했는지
// 를 요약해서 GitHub Actions output으로 내보냄

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const topN = Number(process.argv[3] ?? 8);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Log file not found: ${logFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/);

let currentRequest = "";
let lastTestName = "";
const failures = [];
let assertionErrorCount = 0;

// Newman CLI 출력에서 request 라인으로 자주 나오는 패턴들
const reqPatterns = [
  /^\s*→\s+(.*)\s*$/,     // "→ Request Name"
  /^\s*↳\s+(.*)\s*$/,     // "↳ Request Name"
  /^\s*Request:\s+(.*)\s*$/i
];

// Newman CLI에서 test 라인(보통 "1. xxx" 형태)
const testPattern = /^\s*\d+\.\s+(.*)\s*$/;

for (const line of lines) {
  // request name 추적
  for (const p of reqPatterns) {
    const m = line.match(p);
    if (m) {
      currentRequest = m[1].trim();
      break;
    }
  }

  // test name 추적
  const t = line.match(testPattern);
  if (t) lastTestName = t[1].trim();

  // AssertionError 집계 + 실패 기록
  if (/AssertionError/i.test(line)) {
    assertionErrorCount += 1;
    failures.push({
      request: currentRequest || "(unknown request)",
      assertion: lastTestName || "(unknown assertion)"
    });
  }
}

// request별 집계
const byRequest = new Map();
for (const f of failures) {
  if (!byRequest.has(f.request)) byRequest.set(f.request, []);
  byRequest.get(f.request).push(f);
}

// Slack에 넣기 좋은 요약 텍스트 생성
let shown = 0;
const parts = [];

for (const [req, items] of byRequest.entries()) {
  if (shown >= topN) break;

  const counts = items.length;

  // request별로 assertion 샘플 2개만 보여주기
  const sample = [...new Set(items.map((x) => x.assertion))]
    .slice(0, 2)
    .map((a) => `• ${a}`)
    .join("\n");

  parts.push(`*${req}* (AssertionError ${counts}건)\n${sample}`);
  shown += counts;
}

let summaryText = "";
if (failures.length === 0) {
  summaryText = "No AssertionError found in newman.log";
} else {
  summaryText = parts.join("\n\n");
  if (failures.length > topN) {
    summaryText += `\n\n…and more (total AssertionError: ${failures.length})`;
  }
}

// ✅ GitHub Actions output 형식으로 출력
// node scripts/summarize-newman-log.js ... >> $GITHUB_OUTPUT 로 붙여 쓰는 방식
console.log(`assertion_error_count=${assertionErrorCount}`);
console.log("failure_summary<<EOF");
console.log(summaryText);
console.log("EOF");
