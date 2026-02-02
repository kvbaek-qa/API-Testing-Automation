// scripts/check-newman-threshold.js
// 목적:
// 1) newman.log에서 AssertionError 총 개수 집계 -> global gate
// 2) newman.log에서 status-code 관련 AssertionError를 API(inside "...")별로 집계
//    - WARN threshold: known flaky 범위 가시화 (CI PASS)
//    - FAIL threshold: known 범위 초과 시 CI FAIL
// 3) gate 결과를 GitHub Actions output으로 제공하여 YAML에서 케이스를 분리 가능하게 함
//
// 사용(권장):
//   node scripts/check-newman-threshold.js report/newman.log 40 30 15
//   (logFile) (globalAssertionThreshold) (perApiStatusFailThreshold) (perApiStatusWarnThreshold)
//
// 하위호환:
//   node scripts/check-newman-threshold.js report/newman.log 40 30
//   -> WARN = FAIL 로 취급 (WARN 분리 없이 기존처럼 동작)
//
// 기본값:
//   logFile: report/newman.log
//   globalThreshold: 3
//   perApiStatusFailThreshold: 3
//   perApiStatusWarnThreshold: (없으면 fail과 동일)

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const globalThreshold = Number(process.argv[3] ?? 3);

// FAIL threshold (per-API status)
const perApiStatusFailThreshold = Number(process.argv[4] ?? 3);

// WARN threshold (per-API status) - optional
const perApiStatusWarnThresholdRaw = process.argv[5];
const perApiStatusWarnThreshold =
  perApiStatusWarnThresholdRaw === undefined || perApiStatusWarnThresholdRaw === null
    ? perApiStatusFailThreshold
    : Number(perApiStatusWarnThresholdRaw);

const isGithubActions = !!process.env.GITHUB_OUTPUT;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(logFile)) {
  die(`[FAIL] Newman log file not found: ${logFile}`);
}

if (
  Number.isNaN(globalThreshold) ||
  Number.isNaN(perApiStatusFailThreshold) ||
  Number.isNaN(perApiStatusWarnThreshold)
) {
  die(
    `[FAIL] Invalid numeric thresholds. global=${process.argv[3]} fail=${process.argv[4]} warn=${process.argv[5]}`
  );
}

// WARN <= FAIL 이어야 자연스럽다 (WARN가 더 빡세면 의미가 뒤집힘)
if (perApiStatusWarnThreshold > perApiStatusFailThreshold) {
  die(
    `[FAIL] Invalid thresholds: WARN(${perApiStatusWarnThreshold}) must be <= FAIL(${perApiStatusFailThreshold}).`
  );
}

const content = fs.readFileSync(logFile, "utf8");

// -----------------------------
// 1) Global: AssertionError total count
// -----------------------------
const assertionErrorMatches = content.match(/AssertionError/gi);
const failureCount = assertionErrorMatches ? assertionErrorMatches.length : 0;

// -----------------------------
// 2) Per-API: Status-code-related failures by API
// -----------------------------
function extractFirst(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  return m[1] ?? null;
}

function isStatusCodeFailureBlock(block) {
  // Newman 로그 메시지 형태가 조금씩 달라서 넓게 잡음
  // 예: "AssertionError: Status code is 200"
  // 예: "AssertionError: expected response code 200 but got 202"
  return /status\s*code/i.test(block) || /response\s*code/i.test(block);
}

function parseStatusMismatchByApi(logText) {
  const parts = logText.split(/AssertionError/);

  const byApi = {};
  let totalStatusMismatch = 0;

  for (let i = 1; i < parts.length; i++) {
    const block = "AssertionError" + parts[i];

    if (!isStatusCodeFailureBlock(block)) continue;

    totalStatusMismatch++;

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

const { byApi: statusMismatchByApi, totalStatusMismatch } =
  parseStatusMismatchByApi(content);

// WARN 대상: cnt > warnThreshold
const warnStatusApis = Object.entries(statusMismatchByApi)
  .filter(([, cnt]) => cnt > perApiStatusWarnThreshold)
  .sort((a, b) => b[1] - a[1]);

// FAIL 대상: cnt > failThreshold
const overStatusApis = Object.entries(statusMismatchByApi)
  .filter(([, cnt]) => cnt > perApiStatusFailThreshold)
  .sort((a, b) => b[1] - a[1]);

// worst API
let worstApi = "";
let worstApiCount = 0;
for (const [api, cnt] of Object.entries(statusMismatchByApi)) {
  if (cnt > worstApiCount) {
    worstApiCount = cnt;
    worstApi = api;
  }
}

// -----------------------------
// Gate 판정
// -----------------------------
const globalGatePass = failureCount <= globalThreshold;

// statusGatePass는 FAIL 기준만 본다 (CI 실패 여부)
const statusGatePass = overStatusApis.length === 0;

// WARN 플래그 (CI는 PASS지만 운영 가시화)
const statusWarn = warnStatusApis.length > 0;

// -----------------------------
// Console summary (사람용)
// -----------------------------
console.log("=== Newman Gate Summary ===");
console.log(`Log file: ${logFile}`);
console.log(`Global (AssertionError) count: ${failureCount}`);
console.log(`Global threshold: ${globalThreshold}`);
console.log(
  `Per-API status thresholds: WARN>${perApiStatusWarnThreshold}, FAIL>${perApiStatusFailThreshold}`
);
console.log(`Total status-code-related failures: ${totalStatusMismatch}`);

if (Object.keys(statusMismatchByApi).length > 0) {
  const top = Object.entries(statusMismatchByApi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("Status mismatch by API (top):");
  for (const [api, cnt] of top) {
    const flag =
      cnt > perApiStatusFailThreshold
        ? " <-- FAIL"
        : cnt > perApiStatusWarnThreshold
        ? " <-- WARN"
        : "";
    console.log(`- ${api}: ${cnt}${flag}`);
  }
}

if (!globalGatePass) {
  console.error(
    `[FAIL] Global gate failed: AssertionError (${failureCount}) > threshold (${globalThreshold})`
  );
}

if (!statusGatePass) {
  console.error(
    `[FAIL] Per-API status gate failed: ${overStatusApis.length} API(s) exceeded FAIL threshold (${perApiStatusFailThreshold})`
  );
  for (const [api, cnt] of overStatusApis) {
    console.error(`  - ${api}: ${cnt}`);
  }
} else if (statusWarn) {
  console.warn(
    `[WARN] Per-API status warning: ${warnStatusApis.length} API(s) exceeded WARN threshold (${perApiStatusWarnThreshold})`
  );
  for (const [api, cnt] of warnStatusApis.slice(0, 10)) {
    console.warn(`  - ${api}: ${cnt}`);
  }
}

// -----------------------------
// GitHub Actions outputs (기계용)
// -----------------------------
if (isGithubActions) {
  const out = [];

  // 기존 호환 키(최대한 유지)
  out.push(`global_failure_count=${failureCount}`);
  out.push(`global_threshold=${globalThreshold}`);
  out.push(`status_mismatch_total=${totalStatusMismatch}`);

  // ✅ YAML 최종본이 기대하는 키
  out.push(`global_gate_pass=${globalGatePass ? "true" : "false"}`);
  out.push(`status_gate_pass=${statusGatePass ? "true" : "false"}`);
  out.push(`status_warn=${statusWarn ? "true" : "false"}`);

  out.push(`per_api_status_fail_threshold=${perApiStatusFailThreshold}`);
  out.push(`per_api_status_warn_threshold=${perApiStatusWarnThreshold}`);

  // 아래 키는 네 기존 YAML/로그에서 쓰던 표현도 살려둠
  // (이전 키명: per_api_status_threshold)
  out.push(`per_api_status_threshold=${perApiStatusFailThreshold}`);

  out.push(`worst_status_api=${worstApi ?? ""}`);
  out.push(`worst_status_api_count=${worstApiCount}`);

  // CSV 형태(슬랙/로그에서 한 줄로 보기 편함)
  // FAIL 대상 예: "apiA:31,apiB:40"
  const overCsv = overStatusApis.map(([api, cnt]) => `${api}:${cnt}`).join(",");
  out.push(`over_status_apis=${overCsv}`);

  // WARN 대상 예: "apiA:16,apiB:20"
  const warnCsv = warnStatusApis.map(([api, cnt]) => `${api}:${cnt}`).join(",");
  out.push(`warn_status_apis=${warnCsv}`);

  // JSON도 필요하면 쓰라고 제공(한 줄)
  out.push(`status_mismatch_by_api_json=${JSON.stringify(statusMismatchByApi)}`);

  fs.appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
}

// -----------------------------
// Exit code (CI용)
// -----------------------------
// WARN만 있으면 PASS (exit 0)
// FAIL gate (global or per-API FAIL)면 exit 1
if (!globalGatePass || !statusGatePass) process.exit(1);

console.log("[PASS] All FAIL gates passed (global + per-API status).");
process.exit(0);
