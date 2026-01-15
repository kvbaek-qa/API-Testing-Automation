// scripts/summarize-newman-log.js
// report/newman.log에서 AssertionError 블록을 파싱해서
// - inside "..." 라인에 있는 request(실패 API) 기준으로 집계
// - AssertionError 라인의 assertion 이름 기준으로 집계
// Slack에 넣기 좋은 불렛 형태로 출력 (GITHUB_OUTPUT용)

const fs = require("fs");

const logFile = process.argv[2] || "report/newman.log";
const topRequests = Number(process.argv[3] ?? 10);

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

// 패턴
// 1) "1. AssertionError   Status code is 200" 같은 라인
const assertionHeader = /^\s*\d+\.\s+AssertionError\s+(.*)\s*$/i;

// 2) inside "...." 라인 (여기에서 실패 API 이름을 확정)
const insideLine = /^\s*inside\s+"(.+)"\s*$/i;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const ah = line.match(assertionHeader);
  if (!ah) continue;

  // AssertionError 발견
  assertionErrorCount += 1;
  const assertionName = ah[1].trim(); // 예: "Status code is 200"

  // 해당 AssertionError 블록에서 'inside "..."'를 찾는다 (보통 몇 줄 아래에 있음)
  let requestName = "";
  for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
    const m = lines[j].match(insideLine);
    if (m) {
      requestName = m[1].trim();
      break;
    }
    // 다음 AssertionError 블록이 시작되면 중단
    if (assertionHeader.test(lines[j])) break;
  }

  bump(requestName, assertionName);
}

// Slack용 불렛 텍스트 생성 (request별 총 실패 수 기준 정렬)
const reqList = [...agg.entries()]
  .map(([req, m]) => {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    return { req, m, total };
  })
  .sort((a, b) => b.total - a.total);

let bullets = "";
if (reqList.length === 0) {
  bullets = "• (none)";
} else {
  const sliced = reqList.slice(0, topRequests);
  bullets = sliced
    .map(({ req, m, total }) => {
      const assertions = [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([a, c]) => `  - ${a} (x${c})`)
        .join("\n");

      return `• *${req}* (x${total})\n${assertions}`;
    })
    .join("\n");
}

// ✅ GitHub Actions output 형식으로 출력
console.log(`assertion_error_count=${assertionErrorCount}`);
console.log("failure_bullets<<EOF");
console.log(bullets);
console.log("EOF");
