// scripts/check-newman-threshold.js
// 목적:
// 1) newman.log에서 AssertionError 총 개수 집계 -> global gate
// 2) newman.log에서 status-code 관련 AssertionError를 API(inside "...")별로 집계 -> per-API status gate
// 3) gate 결과를 GitHub Actions output으로 제공하여 YAML에서 3번/4번 케이스를 분리 가능하게 함
//
// 사용:
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

const isGithubActions = !!process.env.GITHUB_OUTPUT;

if (!fs.existsSync(logFile)) {
  console.error(`[FAIL] Newman log file not found: ${logFile}`);
  process.exit(1);
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

// over-threshold API들
const overStatusApis = Object.entries(statusMismatchByApi)
  .filter(([, cnt]) => cnt > perApiStatusThreshold)
  .sort((a, b) => b[1] - a[1]); // desc

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
const statusGatePass = overStatusApis.length === 0;

console.log("=== Newman Gate Summary ===");
console.log(`Log file: ${logFile}`);
console.log(`Global (AssertionError) count: ${failureCount}`);
console.log(`Global threshold: ${globalThreshold}`);
console.log(`Per-API status threshold: ${perApiStatusThreshold}`);
console.log(`Total status-code-related failures: ${totalStatusMismatch}`);

if (Object.keys(statusMismatchByApi).length > 0) {
  const top = Object.entries(statusMismatchByApi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log("Status mismatch by API (top):");
  for (const [api, cnt] of top) {
    const over = cnt > perApiStatusThreshold ? " <-- OVER" : "";
    console.log(`- ${api}: ${cnt}${over}`);
  }
}

if (!globalGatePass) {
  console.error(
    `[FAIL] Global gate failed: AssertionError (${failureCount}) > threshold (${globalThreshold})`
  );
}
if (!statusGatePass) {
  console.error(
    `[FAIL] Per-API status gate failed: ${overStatusApis.length} API(s) exceeded threshold (${perApiStatusThreshold})`
  );
  for (const [api, cnt] of overStatusApis) {
    console.error(`  - ${api}: ${cnt}`);
  }
}

// -----------------------------
// GitHub Actions outputs (기계용)
// -----------------------------
if (isGithubActions) {
  const out = [];
  out.push(`global_failure_count=${failureCount}`);
  out.push(`global_threshold=${globalThreshold}`);
  out.push(`per_api_status_threshold=${perApiStatusThreshold}`);
  out.push(`status_mismatch_total=${totalStatusMismatch}`);

  out.push(`global_gate_pass=${globalGatePass ? "true" : "false"}`);
  out.push(`status_gate_pass=${statusGatePass ? "true" : "false"}`);

  out.push(`worst_status_api=${worstApi ?? ""}`);
  out.push(`worst_status_api_count=${worstApiCount}`);

  // CSV 형태(슬랙/로그에서 한 줄로 보기 편함)
  // 예: "apiA:26,apiB:4"
  const overCsv = overStatusApis.map(([api, cnt]) => `${api}:${cnt}`).join(",");
  out.push(`over_status_apis=${overCsv}`);

  // JSON도 필요하면 쓰라고 제공(한 줄)
  out.push(`status_mismatch_by_api_json=${JSON.stringify(statusMismatchByApi)}`);

  fs.appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
}

if (!globalGatePass || !statusGatePass) process.exit(1);

console.log("[PASS] All gates passed (global + per-API status).");
process.exit(0);
