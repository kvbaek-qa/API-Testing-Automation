// scripts/check-newman-threshold.js
// 목적:
// 1) newman.log에서 AssertionError(전체 실패) 개수 집계 -> 글로벌 threshold로 CI gate
// 2) newman.log에서 "Status code" assertion 실패를 API(요청/item)별로 집계 -> API별 threshold로 추가 gate
// 3) GitHub Actions에서 재사용 가능한 output 제공
//
// 사용 예시:
//   node scripts/check-newman-threshold.js report/newman.log 40 3
//   (logFile) (globalAssertionThreshold) (perApiStatusThreshold)
//
// 기본값:
//   logFile: report/newman.log
//   globalThreshold: 3
//   perApiStatusThreshold: 3

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const globalThreshold = Number(process.argv[3] ?? 3);
const perApiStatusThreshold = Number(process.argv[4] ?? 3);

// GitHub Actions 환경 여부
const isGithubActions = !!process.env.GITHUB_OUTPUT;

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf8");

// -----------------------------
// 1) 글로벌: AssertionError 총 개수
// -----------------------------
const assertionErrorMatches = content.match(/AssertionError/gi);
const failureCount = assertionErrorMatches ? assertionErrorMatches.length : 0;

// -----------------------------
// 2) API별: Status code assertion 실패 집계
//   - Newman 로그 포맷에 따라 "inside \"<item name>\"" 형태가 흔함
//   - AssertionError 블록마다 메시지에 "Status code is ..."가 있으면 status mismatch로 카운트
//   - item name 추출이 안되면 UNKNOWN으로 집계
// -----------------------------

/**
 * Newman 실패 블록들에서:
 * - 메시지에 "Status code is" 포함된 AssertionError만 골라서
 * - 해당 블록 주변에서 item name(inside "...")를 찾아 API별 카운트
 */
function parseStatusMismatchByApi(logText) {
  // AssertionError를 기준으로 블록을 대충 쪼갬 (첫 토큰 앞은 버림)
  const parts = logText.split(/AssertionError/);

  const byApi = {};
  let totalStatusMismatch = 0;

  for (let i = 1; i < parts.length; i++) {
    const block = "AssertionError" + parts[i];

    // Status code assertion 실패인지 확인
    // 예: "AssertionError: Status code is 200"
    //     "AssertionError: expected response code 200 but got 202"
    const isStatusCodeFailure =
      /Status\s*code/i.test(block) ||
      /response\s*code/i.test(block) ||
      /expected\s*.*\b200\b.*\b202\b/i.test(block);

    if (!isStatusCodeFailure) continue;

    totalStatusMismatch++;

    // item/request name 추출 시도 (로그 포맷별로 최대한 커버)
    // 흔한 케이스: inside "TTS ... spw-jhb-normal-stream"
    // 혹은: inside <name> / in "<name>"
    const name =
      extractFirst(block, /inside\s+"([^"]+)"/i) ||
      extractFirst(block, /inside\s+'([^']+)'/i) ||
      extractFirst(block, /inside\s+([^\n\r]+)/i) ||
      extractFirst(block, /\bin\s+"([^"]+)"/i) ||
      extractFirst(block, /\bin\s+'([^']+)'/i) ||
      null;

    const apiName = (name ? String(name).trim() : "UNKNOWN_API").slice(0, 200);

    byApi[apiName] = (byApi[apiName] || 0) + 1;
  }

  return { byApi, totalStatusMismatch };
}

function extractFirst(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  return m[1] ?? null;
}

const { byApi: statusMismatchByApi, totalStatusMismatch } =
  parseStatusMismatchByApi(content);

// worst API 찾기
let worstApi = null;
let worstApiCount = 0;
for (const [api, cnt] of Object.entries(statusMismatchByApi)) {
  if (cnt > worstApiCount) {
    worstApiCount = cnt;
    worstApi = api;
  }
}

// -----------------------------
// 출력 (사람용)
// -----------------------------
console.log("=== Newman CI Gate Summary ===");
console.log(`Log file: ${logFile}`);
console.log(`Total AssertionError count: ${failureCount}`);
console.log(`Global threshold (AssertionError): ${globalThreshold}`);
console.log("");
console.log("=== API-level Status Code Gate ===");
console.log(`Total status-code-related failures: ${totalStatusMismatch}`);
console.log(`Per-API status threshold: ${perApiStatusThreshold}`);

if (Object.keys(statusMismatchByApi).length === 0) {
  console.log(
    "Status mismatch by API: (none detected in log OR log format didn't include recognizable markers)"
  );
} else {
  // 상위 몇 개만 보기 좋게 출력
  const sorted = Object.entries(statusMismatchByApi).sort((a, b) => b[1] - a[1]);
  console.log("Status mismatch by API (top):");
  for (const [api, cnt] of sorted.slice(0, 10)) {
    const over = cnt > perApiStatusThreshold ? "  <-- OVER THRESHOLD" : "";
    console.log(`- ${api}: ${cnt}${over}`);
  }
  if (sorted.length > 10) console.log(`...and ${sorted.length - 10} more`);
}

console.log("");

// -----------------------------
// GitHub Actions output (기계용)
// -----------------------------
if (isGithubActions) {
  const out = [];
  out.push(`failure_count=${failureCount}`);
  out.push(`global_threshold=${globalThreshold}`);
  out.push(`status_threshold_per_api=${perApiStatusThreshold}`);
  out.push(`status_mismatch_total=${totalStatusMismatch}`);
  out.push(`worst_api=${worstApi ?? ""}`);
  out.push(`worst_api_count=${worstApiCount}`);
  // JSON은 멀티라인 깨질 수 있어서 한 줄로
  out.push(
    `status_mismatch_by_api_json=${JSON.stringify(statusMismatchByApi)}`
  );
  fs.appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
}

// -----------------------------
// Gate 판정
// 1) 글로벌 AssertionError gate
// 2) API별 status gate (어느 하나라도 threshold 초과면 FAIL)
// -----------------------------
let failed = false;

if (failureCount > globalThreshold) {
  console.error(
    `[FAIL] Global gate failed: AssertionError (${failureCount}) > threshold (${globalThreshold})`
  );
  failed = true;
}

const overApis = Object.entries(statusMismatchByApi).filter(
  ([, cnt]) => cnt > perApiStatusThreshold
);

if (overApis.length > 0) {
  console.error(
    `[FAIL] API-level status gate failed: ${overApis.length} API(s) exceeded per-API threshold (${perApiStatusThreshold})`
  );
  for (const [api, cnt] of overApis.sort((a, b) => b[1] - a[1])) {
    console.error(`  - ${api}: ${cnt}`);
  }
  failed = true;
}

if (failed) process.exit(1);

console.log("[PASS] All gates passed (global + API-level status).");
process.exit(0);
