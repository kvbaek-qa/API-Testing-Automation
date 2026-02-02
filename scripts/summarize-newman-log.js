// scripts/summarize-newman-log.js
// report/newman.log에서 AssertionError 블록을 파싱해서 Slack에 넣기 좋은 요약을 만든다.
//
// ✅ YAML 변경 없이 호환되는 최종본
// - 기존 사용 형태 유지:
//   node scripts/summarize-newman-log.js report/newman.log 10 <perApiStatusFailThreshold>
//   (logFile) (topRequests) (perApiStatusFailThreshold)
//
// - (선택) 4번째 인자로 WARN threshold도 받을 수 있음 (YAML이 안 넘겨도 됨)
//   node scripts/summarize-newman-log.js report/newman.log 10 30 15
//
// 기능:
// - inside "..." 라인의 request(실패 API) 기준 집계
// - AssertionError 라인의 assertion 이름 기준 집계
// - request별 status-code 관련 실패 수 집계
// - threshold 초과 표시:
//   - FAIL: statusCnt > perApiStatusFailThreshold -> "🚨 FAIL(status)"
//   - WARN: (옵션) statusCnt > perApiStatusWarnThreshold -> "⚠ WARN(status)"
//
// 출력(GitHub Actions output friendly):
// - assertion_error_count=...
// - failure_bullets<<EOF ... EOF
// - (추가 출력은 YAML이 참조하지 않아도 무해)

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const topRequests = Number(process.argv[3] ?? 10);

// YAML이 넘기는 3번째 인자(기존 perApiStatusThreshold)는 여기서 "FAIL threshold"로 해석
const perApiStatusFailThreshold = Number(process.argv[4] ?? 3);

// WARN threshold는 선택 (없으면 WARN 표시를 생략하거나 FAIL과 동일 처리)
// ✅ YAML은 안 넘기므로 기본은 "WARN 비활성"로 두는 게 가장 안전
const perApiStatusWarnThresholdRaw = process.argv[5];
const perApiStatusWarnThreshold =
  perApiStatusWarnThresholdRaw === undefined || perApiStatusWarnThresholdRaw === null
    ? null
    : Number(perApiStatusWarnThresholdRaw);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(logFile)) {
  die(`[FAIL] Log file not found: ${logFile}`);
}

if (Number.isNaN(topRequests) || Number.isNaN(perApiStatusFailThreshold)) {
  die(
    `[FAIL] Invalid numeric args. topRequests=${process.argv[3]} fail=${process.argv[4]}`
  );
}

if (perApiStatusWarnThreshold !== null) {
  if (Number.isNaN(perApiStatusWarnThreshold)) {
    die(`[FAIL] Invalid WARN threshold: ${process.argv[5]}`);
  }
  if (perApiStatusWarnThreshold > perApiStatusFailThreshold) {
    die(
      `[FAIL] Invalid thresholds: WARN(${perApiStatusWarnThreshold}) must be <= FAIL(${perApiStatusFailThreshold}).`
    );
  }
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

// request별 status-code 관련 실패 카운트
const statusByReq = new Map();
function bumpStatus(req) {
  const r = req || "(unknown request)";
  statusByReq.set(r, (statusByReq.get(r) || 0) + 1);
}

// 패턴
const assertionHeader = /^\s*\d+\.\s+AssertionError\s+(.*)\s*$/i;
const insideLine = /^\s*inside\s+"(.+)"\s*$/i;

function isStatusCodeAssertion(assertionName) {
  if (!assertionName) return false;
  return /status\s*code/i.test(assertionName) || /response\s*code/i.test(assertionName);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const ah = line.match(assertionHeader);
  if (!ah) continue;

  assertionErrorCount += 1;
  const assertionName = (ah[1] || "").trim();

  let requestName = "";
  for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
    const m = lines[j].match(insideLine);
    if (m) {
      requestName = (m[1] || "").trim();
      break;
    }
    if (assertionHeader.test(lines[j])) break;
  }

  bump(requestName, assertionName);

  if (isStatusCodeAssertion(assertionName)) {
    bumpStatus(requestName);
  }
}

// request별 총 실패 수 기준 정렬
const reqList = [...agg.entries()]
  .map(([req, m]) => {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    const statusCnt = statusByReq.get(req) || 0;
    return { req, m, total, statusCnt };
  })
  .sort((a, b) => b.total - a.total);

function statusMark(statusCnt) {
  // FAIL 기준
  if (statusCnt > perApiStatusFailThreshold) return " 🚨 FAIL(status)";

  // WARN 기준은 YAML이 넘기지 않으므로 기본적으로는 표시 안 함.
  // (하지만 스크립트를 CLI로 직접 돌릴 땐 4번째 인자 넣어서 WARN도 보고 싶을 수 있음)
  if (perApiStatusWarnThreshold !== null && statusCnt > perApiStatusWarnThreshold) {
    return " ⚠ WARN(status)";
  }

  return "";
}

function formatReqTitle(req, total, statusCnt) {
  const statusInfo = statusCnt > 0 ? `, status(x${statusCnt})` : "";
  return `• *${req}* (x${total}${statusInfo})${statusMark(statusCnt)}`;
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

// ✅ GitHub Actions output 형식으로 출력 (YAML 호환 키 유지)
console.log(`assertion_error_count=${assertionErrorCount}`);
console.log("failure_bullets<<EOF");
console.log(bullets);
console.log("EOF");

// (추가 출력: YAML이 안 써도 무해 — 나중에 확장용)
const failStatusReqCsv = reqList
  .filter(({ statusCnt }) => statusCnt > perApiStatusFailThreshold)
  .map(({ req, statusCnt }) => `${req}:${statusCnt}`)
  .join(",");
console.log(`fail_status_req_csv=${failStatusReqCsv}`);
