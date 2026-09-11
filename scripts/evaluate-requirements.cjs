const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const XLSX = require("xlsx");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);

const { buildKaUserContent } = require("../src/lib/promptMapping.ts");
const {
  isInternalSourceUrl,
  loopioFormatIssues,
  separateClientFacingResponse,
} = require("../src/lib/responsePolicy.ts");

const [input, outputDir] = process.argv.slice(2);
if (!input || !outputDir) {
  throw new Error("Usage: node scripts/evaluate-requirements.cjs INPUT.xlsx NEW_OUTPUT_DIR");
}
fs.mkdirSync(outputDir); // Refuse to overwrite previous evidence.

const workbook = XLSX.readFile(input, { cellFormula: true, cellStyles: true });
const selected = [];
const sheets = [];

for (const sheetName of workbook.SheetNames.slice(1)) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headerRow = grid.findIndex((row) =>
    row.includes("ID") && row.includes("Theme") && row.includes("Requirement") &&
    row.includes("Supplier Response") && row.includes("Justification and Supporting Evidence"),
  );
  if (headerRow < 0) throw new Error(`Could not map response columns in ${sheetName}`);
  const header = grid[headerRow];
  const columns = {
    id: header.indexOf("ID"),
    theme: header.indexOf("Theme"),
    title: header.indexOf("Title"),
    requirement: header.indexOf("Requirement"),
    response: header.indexOf("Supplier Response"),
    evidence: header.indexOf("Justification and Supporting Evidence"),
  };
  const rows = grid.map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row, rowIndex }) => rowIndex > headerRow && String(row[columns.id]).trim());
  const themes = new Map();
  for (const entry of rows) {
    const theme = String(entry.row[columns.theme]).trim();
    if (!themes.has(theme)) themes.set(theme, []);
    themes.get(theme).push(entry);
  }

  const outputColumn = range.e.c + 1;
  XLSX.utils.sheet_add_aoa(sheet, [[
    "Test Supplier Response",
    "Test Needs Review",
    "Test Diagnostics",
    "Test Duration (s)",
  ]], { origin: { r: headerRow, c: outputColumn } });

  for (const [theme, entries] of themes) {
    const candidates = entries.filter(({ row }) => !String(row[columns.response]).trim());
    const pool = candidates.length ? candidates : entries;
    // The longest requirement usually exercises more clauses and therefore more
    // format, completeness and unsupported-claim failure modes.
    const choice = pool.toSorted((a, b) =>
      String(b.row[columns.requirement]).length - String(a.row[columns.requirement]).length,
    )[0];
    const title = String(choice.row[columns.title]).trim();
    const requirement = String(choice.row[columns.requirement]).trim();
    const question = `${title}\n\nRequirement:\n${requirement}`;
    selected.push({
      sheetName, theme, rowIndex: choice.rowIndex, outputColumn,
      id: String(choice.row[columns.id]).trim(), title, requirement, question,
      existingResponse: String(choice.row[columns.response]).trim(),
    });
  }
  sheets.push({ sheetName, headerRow, rows: rows.length, themes: themes.size });
}

const requestedIds = new Set(
  String(process.env.TEST_REQUIREMENT_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
);
const testItems = requestedIds.size
  ? selected.filter((item) => requestedIds.has(item.id))
  : selected;
if (requestedIds.size && testItems.length !== requestedIds.size) {
  const found = new Set(testItems.map((item) => item.id));
  throw new Error(`Unknown selected IDs: ${[...requestedIds].filter((id) => !found.has(id)).join(", ")}`);
}

function curl(args, inputText) {
  return spawnSync("curl", args, {
    input: inputText,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function assess(answer) {
  const lines = answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const urls = answer.match(/https?:\/\/[^\s)\]]+/g) || [];
  const issues = loopioFormatIssues(answer);
  const words = answer.replace(/https?:\/\/\S+/g, "").split(/\s+/).filter(Boolean).length;
  const internalSentences = separateClientFacingResponse(answer).limitations;
  const markers = /\b(?:BEGIN|END)_CLIENT_ANSWER\b|CONFIDENCE_REVIEW/i.test(answer);
  const internalUrls = urls.filter(isInternalSourceUrl);
  const lengthWarning = words < 140 || words > 550;
  return {
    words,
    bullets: lines.filter((line) => /^•\s/.test(line)).length,
    issues,
    internalSentences,
    markers,
    internalUrls,
    lengthWarning,
    pass: !issues.length && !internalSentences.length && !markers && !internalUrls.length &&
      !lengthWarning && Boolean(answer.trim()),
  };
}

const report = [];
const outputFile = path.join(outputDir, "Attachment-A-intensive-test.xlsx");
const reportFile = path.join(outputDir, "results.json");
const endpoint = `${(process.env.KA_URL || "https://dy-knowledge-assistant.use1.dynamicyield.com").replace(/\/$/, "")}/api/chat`;

console.log(`${testItems.length} questions selected across ${sheets.length} sheets (${selected.length} themes available).`);
console.log("Existing Supplier Response cells are never sent to KA or overwritten.");

for (let index = 0; index < testItems.length; index++) {
  const item = testItems[index];
  const opts = { question: item.question, mode: "loopio", confidenceReview: true };
  const started = Date.now();
  const result = {
    ...item,
    existingResponse: item.existingResponse ? "[occupied; preserved]" : "",
    raw: "",
    answer: "",
    reviewRequired: false,
    reviewReason: "",
    assessment: null,
    seconds: 0,
    error: "",
  };
  try {
    const content = buildKaUserContent(item.question, opts);
    const generated = curl([
      "--silent", "--show-error", "--fail-with-body", "--max-time", "190",
      endpoint, "-H", "Content-Type: application/json", "--data-binary", "@-",
    ], JSON.stringify({ messages: [{ role: "user", content }] }));
    if (generated.error || generated.status !== 0) {
      throw new Error(`KA: ${generated.error?.message || generated.stderr || `curl exit ${generated.status}`}`.trim());
    }
    result.raw = generated.stdout;
    const normalized = curl([
      "--silent", "--show-error", "--fail-with-body", "--max-time", "30",
      "http://localhost:3000/api/ask", "-H", "Content-Type: application/json",
      "--data-binary", "@-",
    ], JSON.stringify({ ...opts, backend: "ka", localKaResponse: result.raw }));
    if (normalized.error || normalized.status !== 0) {
      throw new Error(`App: ${normalized.error?.message || normalized.stderr || `curl exit ${normalized.status}`}`.trim());
    }
    const response = JSON.parse(normalized.stdout);
    result.answer = String(response.answer || "");
    result.reviewRequired = response.reviewRequired === true;
    result.reviewReason = String(response.reviewReason || "");
    result.assessment = assess(result.answer);
    assert.ok(result.answer.trim(), "The app returned an empty answer.");
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.seconds = (Date.now() - started) / 1000;
  report.push(result);

  const diagnostics = result.error
    ? `ERROR: ${result.error}`
    : JSON.stringify(result.assessment);
  XLSX.utils.sheet_add_aoa(workbook.Sheets[item.sheetName], [[
    result.answer,
    result.reviewReason,
    diagnostics,
    result.seconds,
  ]], { origin: { r: item.rowIndex, c: item.outputColumn } });
  XLSX.writeFile(workbook, outputFile, { cellStyles: true });
  fs.writeFileSync(reportFile, JSON.stringify({ sheets, selected: selected.length, results: report }, null, 2));

  const status = result.error ? "ERROR" : result.assessment.pass ? "PASS" : "REVIEW";
  console.log(
    `${index + 1}/${testItems.length} ${item.sheetName} ${item.id} ${status} ` +
    `${result.seconds.toFixed(1)}s` +
    (result.assessment ? ` ${result.assessment.words}w ${result.assessment.bullets} bullets` : "") +
    (result.reviewRequired ? " needs-review" : ""),
  );
  if (result.error) {
    // Continue to the next independently selected requirement, but do not
    // regenerate the failed row.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  }
}

const completed = report.filter((item) => !item.error);
const summary = {
  selected: report.length,
  completed: completed.length,
  failed: report.length - completed.length,
  passed: completed.filter((item) => item.assessment.pass).length,
  structuralReview: completed.filter((item) => !item.assessment.pass).length,
  needsReview: completed.filter((item) => item.reviewRequired).length,
  internalCommentary: completed.filter((item) => item.assessment.internalSentences.length).length,
  sourceLeaks: completed.filter((item) => item.assessment.internalUrls.length).length,
  markerLeaks: completed.filter((item) => item.assessment.markers).length,
};
fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
