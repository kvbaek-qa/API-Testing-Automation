// scripts/summarize-newman-log.js
// report/newman.log에서 AssertionError를 파싱해서
// - 실패한 API(Request) 목록
// - 각 API에서 실패한 Assertion 목록 + 횟수
// 를 Slack에 넣기 좋은 불렛 형태로 출력 (GITHUB_OUTPUT용)

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const topRequests = Number(process.argv[3] ?? 10);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Log file not found: ${logFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/);

let currentRequest = "";
let lastTestName = "";
let assertionErrorCount = 0;

// request line 패턴 (Newman CLI에서 흔한 형태들)
const reqPatterns = [
  /^\s*→\s+(.*)\s*$/,      // "→ Request Name"
  /^\s*↳\s+(.*)\s*$/,      // "↳ Request Name"
  /^\s*Request:\s+(.*)\s*$/i
];

// test(assertion) line 패턴 (보통 "1. Status code is 200" 형태)
const testPattern = /^\s*\d+\.\s+(.*)\s*$/;

// 집계: request -> assertion -> count
const agg = new Map();

function bump(req, assertion) {
  const r = req || "(unknown request)";
  const a = assertion || "(unknown assertion)";
  if (!agg.has(r)) agg.set(r, new Map());
  const m = agg.get(r);
  m.set(a, (m.get(a) || 0) + 1);
}

for (const line of lines) {
  // request 추적
  for (const p of reqPatterns) {
    const m = line.match(p);
    if (m) {
      currentRequest = m[1].trim();
      break;
    }
  }

  // assertion(test name) 추적
  const t = line.match(testPattern);
  if (t) lastTestName = t[1].trim();

  // AssertionError 발견
  if (/AssertionError/i.test(line)) {
    assertionErrorCount += 1;
    bump(currentRequest, lastTestName);
  }
}

// Slack용 불렛 텍스트 생성
// - request별 총 실패 수 기준으로 정렬
const reqList = [...agg.entries()].map(([req, m]) => {
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  return { req, m, total };
}).sort((a, b) => b.total - a.total);

let bullets = "";
if (reqList.length === 0) {
  bullets = "• (none)";
} else {
  const sliced = reqList.slice(0, topRequests);
  bullets = sliced.map(({ req, m, total }) => {
    const assertions = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([a, c]) => `  - ${a} (x${c})`)
      .join("\n");

    return `• *${req}* (x${total})\n${assertions}`;
  }).join("\n");
}

// ✅ GITHUB_OUTPUT로 넘기기 좋게 출력
console.log(`assertion_error_count=${assertionErrorCount}`);
console.log("failure_bullets<<EOF");
console.log(bullets);
console.log("EOF");
