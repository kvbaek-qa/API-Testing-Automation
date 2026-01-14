// scripts/check-newman-threshold.js
const fs = require("fs");

const reportPath = process.argv[2] || "report/newman.json";
const threshold = Number(process.argv[3] ?? 3);

if (!fs.existsSync(reportPath)) {
  console.error(`[FAIL] Newman JSON report not found: ${reportPath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (e) {
  console.error(`[FAIL] Cannot parse JSON report: ${reportPath}`);
  console.error(e);
  process.exit(1);
}

// newman json reporter structure: data.run.failures is an array
const failures = data?.run?.failures ?? [];
const failureCount = failures.length;

console.log(`Newman failure count: ${failureCount}`);
console.log(`Allowed max failures: ${threshold}`);

if (failureCount > 0) {
  console.log("---- Failure summary (up to 10) ----");
  failures.slice(0, 10).forEach((f, idx) => {
    const name = f?.source?.name || "(unknown item)";
    const assertion = f?.error?.name || f?.error?.message || "(unknown error)";
    console.log(`${idx + 1}. ${name} -> ${assertion}`);
  });
}

if (failureCount > threshold) {
  console.error(
    `[FAIL] Failure count (${failureCount}) exceeded threshold (${threshold}).`
  );
  process.exit(1);
}

console.log("[PASS] Failure count is within threshold.");
process.exit(0);