// scripts/summarize-newman-log.js
// report/newman.log에서 AssertionError 블록을 파싱해서 Slack에 넣기 좋은 요약을 만든다.
//
// 기능:
// - inside "..." 라인에 있는 request(실패 API) 기준으로 집계
// - AssertionError 라인의 assertion 이름 기준으로 집계
// - (선택) API별 Status Code mismatch threshold를 넘긴 항목에 표시(⚠ OVER)
// - GitHub Actions output 형식으로 출력 (failure_bullets)
//
// 사용 예시:
//   node scripts/summarize-newman-log.js report/newman.log 10 3
//   (logFile) (topRequests) (perApiStatusThreshold)
//
// 기본값:
//   logFile: report/newman.log
//   topRequests: 10
//   perApiStatusThreshold: 3

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const topRequests = Number(process.argv[3] ?? 10);
const perApiStatusThreshold = Number(process.argv[4] ?? 3);

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Log file not found: ${logFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/);

let assertionErrorCount = 0;

// 집계: request -> assertion -> count
const agg = new Map();
function bump(req, assertion) {
  const r = req || "(unknown request)";
  const a = assertion || "(unknown assertion)";
  if (!agg.has(r)) agg.set(r, new Map());
  const m = agg.get(r);
  m.set(a, (m.get(a) || 0) + 1);
}

// (추가) request별 status-code 관련 실패 카운트
// - assertionName에 "Status code" 또는 "response code" 포함 시 status mismatch로 집계
const statusByReq = new Map();
function bumpStatus(req) {
  const r = req || "(unknown request)";
  statusByReq.set(r, (statusByReq.get(r) || 0) + 1);
}

// 패턴
// 1) "1. AssertionError   Status code is 200" 같은 라인
const assertionHeader = /^\s*\d+\.\s+AssertionError\s+(.*)\s*$/i;
// 2) inside "...." 라인 (여기에서 실패 API 이름을 확정)
const insideLine = /^\s*inside\s+"(.+)"\s*$/i;

function isStatusCodeAssertion(assertionName) {
  if (!assertionName) return false;
  return /status\s*code/i.test(assertionName) || /response\s*code/i.test(assertionName);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const ah = line.match(assertionHeader);
  if (!ah) continue;

  // AssertionError 발견
  assertionErrorCount += 1;
  const assertionName = (ah[1] || "").trim(); // 예: "Status code is 200"

  // 해당 AssertionError 블록에서 'inside "..."'를 찾는다 (보통 몇 줄 아래에 있음)
  let requestName = "";
  for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
    const m = lines[j].match(insideLine);
    if (m) {
      requestName = (m[1] || "").trim();
      break;
    }
    // 다음 AssertionError 블록이 시작되면 중단
    if (assertionHeader.test(lines[j])) break;
  }

  bump(requestName, assertionName);

  if (isStatusCodeAssertion(assertionName)) {
    bumpStatus(requestName);
  }
}

// Slack용 불렛 텍스트 생성 (request별 총 실패 수 기준 정렬)
const reqList = [...agg.entries()]
  .map(([req, m]) => {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    const statusCnt = statusByReq.get(req) || 0;
    return { req, m, total, statusCnt };
  })
  .sort((a, b) => b.total - a.total);

// 표시: status threshold 초과 시 ⚠ OVER
function formatReqTitle(req, total, statusCnt) {
  const overStatus = statusCnt > perApiStatusThreshold;
  const overMark = overStatus ? " ⚠ OVER(status)" : "";
  // statusCnt도 같이 보여주면 “어떤 실패가 status 쪽인지” 바로 보임
  const statusInfo = statusCnt > 0 ? `, status(x${statusCnt})` : "";
  return `• *${req}* (x${total}${statusInfo})${overMark}`;
}

let bullets = "";
if (reqList.length === 0) {
  bullets = "• (none)";
} else {
  const sliced = reqList.slice(0, topRequests);
  bullets = sliced
    .map(({ req, m, total, statusCnt }) => {
      const assertions = [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([a, c]) => `  - ${a} (x${c})`)
        .join("\n");

      return `${formatReqTitle(req, total, statusCnt)}\n${assertions}`;
    })
    .join("\n");
}

// ✅ GitHub Actions output 형식으로 출력
console.log(`assertion_error_count=${assertionErrorCount}`);
console.log("failure_bullets<<EOF");
console.log(bullets);
console.log("EOF");
