const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const ts = require("typescript");
const XLSX = require("xlsx");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);
const { buildKaUserContent } = require("../src/lib/promptMapping.ts");
const { normalizeBridgedKaResponse } = require("../src/lib/providers/ka.ts");
const { hasNonClientFacingLanguage, loopioFormatIssues } = require("../src/lib/responsePolicy.ts");

function assess(answer) {
  const lines = answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const words = answer.replace(/https?:\/\/\S+/g, "").split(/\s+/).filter(Boolean).length;
  const sections = lines.filter((line, i) =>
    /^[A-Z][A-Za-z0-9 &/-]+$/.test(line) && line.split(/\s+/).length >= 2 &&
    line.split(/\s+/).length <= 4 && /^• /.test(lines[i + 1] || ""),
  ).length;
  const bullets = lines.filter((line) => /^• /.test(line)).length;
  const example = lines.some((line) => /^(?:for|as an) example[,:\s]/i.test(line));
  const chatter = lines.some((line) => line.split(/(?<=[.!?])\s+/)
    .some((sentence) => hasNonClientFacingLanguage(sentence.replace(/^[•*#_\s-]+/, ""))));
  return { words, sections, bullets, example, chatter,
    formatOK: loopioFormatIssues(answer).length === 0 && !chatter };
}
exports.assess = assess;

const PREAMBLE_FIXTURES = [
  "I have exhausted my search budget and found limited specific information about real-time personalization decision latency for UK users. I need to provide an honest answer based on what is available.",
  "here is the client-facing answer:",
  "I can provide a comprehensive answer about the platform.",
  "Let me compile the client-facing response:",
  "I've reached the search limit for this question.",
  "The dy.dev performance guide mentions a delay but does not provide explicit latency guarantees.",
];

if (require.main === module) {
  const [input, outputDir, mode = "live", limitArg = "18", offsetArg = "0", ...reports] = process.argv.slice(2);
  if (!input || !outputDir || !["live", "reference", "replay"].includes(mode)) {
    throw new Error("Usage: node scripts/evaluate-batch.cjs INPUT.xlsx NEW_OUTPUT_DIR [live|reference|replay] [limit] [question-offset] [replay-report.json ...]");
  }
  const limit = Number(limitArg);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const offset = Number(offsetArg);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  fs.mkdirSync(outputDir); // Refuse to overwrite previous evidence.
  const workbook = XLSX.readFile(input);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = grid.findIndex((row) => row.includes("Question") && row.includes("Answer"));
  if (headerIndex < 0) throw new Error("Expected Question and Answer columns.");
  const questionCol = grid[headerIndex].indexOf("Question");
  const referenceCol = grid[headerIndex].indexOf("Answer");
  const targetCol = grid[headerIndex].findIndex((value) => /^answer 2$/i.test(String(value)));
  if (targetCol < 0) throw new Error("Expected an empty Answer 2 column for generated answers.");
  const selected = grid.map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index > headerIndex && String(row[questionCol]).includes("?")).slice(offset, offset + limit);
  const report = [];
  const recorded = new Map();
  if (mode === "replay") {
    for (const file of reports) {
      for (const entry of JSON.parse(fs.readFileSync(file, "utf8"))) {
        if (recorded.has(entry.row)) throw new Error(`Duplicate recorded row ${entry.row}`);
        recorded.set(entry.row, entry);
      }
    }
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const reviewCol = range.e.c + 1;
  XLSX.utils.sheet_add_aoa(sheet, [["Test Review", "Test Format", "Test Duration (s)"]], { origin: { r: headerIndex, c: reviewCol } });
  console.log(`${selected.length} questions; mode=${mode}; reference answers are NOT sent to KA.`);
  for (const { row, index } of selected) {
    if (String(row[targetCol]).trim()) throw new Error(`Answer 2 is not empty at row ${index + 1}.`);
    const question = String(row[questionCol]);
    const opts = { question, mode: "loopio", confidenceReview: true };
    const started = Date.now();
    let raw = String(row[referenceCol]);
    if (mode === "replay") {
      const entry = recorded.get(index + 1);
      if (!entry || entry.question !== question || typeof entry.raw !== "string" || !entry.raw.trim()) {
        throw new Error(`Missing or mismatched recorded response for row ${index + 1}`);
      }
      raw = entry.raw;
    }
    if (mode === "live") {
      const result = spawnSync("curl", [
        "--silent", "--show-error", "--fail-with-body", "--max-time", "190",
        `${(process.env.KA_URL || "https://dy-knowledge-assistant.use1.dynamicyield.com").replace(/\/$/, "")}/api/chat`,
        "-H", "Content-Type: application/json", "--data-binary", "@-",
      ], {
        input: JSON.stringify({ messages: [{ role: "user", content: buildKaUserContent(question, opts) }] }),
        encoding: "utf8", maxBuffer: 5 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        fs.writeFileSync(path.join(outputDir, "failure.json"), JSON.stringify({
          row: index + 1, question, error: result.error?.message || result.stderr, status: result.status,
        }, null, 2));
        throw new Error(`KA request failed at row ${index + 1}: ${result.error?.message || result.stderr}`);
      }
      raw = result.stdout;
    }
    let referenceChecks = 0;
    if (mode === "reference") {
      for (const style of ["loopio", "simple", "detailed", "custom"]) {
        const settings = { ...opts, mode: style, customPrompt: "Keep the requested format." };
        const expected = normalizeBridgedKaResponse(raw, settings).answer;
        assert.ok(expected.trim(), `Reference content was lost at row ${index + 1}`);
        for (const preamble of PREAMBLE_FIXTURES) {
          for (const separator of [" ", "\n\n"]) {
            assert.equal(normalizeBridgedKaResponse(preamble + separator + raw, settings).answer, expected,
              `Row ${index + 1}, ${style}: leaked preamble or lost customer content`);
            referenceChecks++;
          }
        }
      }
    }
    const normalized = normalizeBridgedKaResponse(raw, opts);
    if (mode === "replay") {
      const result = spawnSync("curl", [
        "--silent", "--show-error", "--fail-with-body", "--max-time", "30",
        "http://localhost:3000/api/ask", "-H", "Content-Type: application/json", "--data-binary", "@-",
      ], {
        input: JSON.stringify({ ...opts, backend: "ka", localKaResponse: raw }),
        encoding: "utf8", maxBuffer: 5 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) throw new Error(`App replay failed for row ${index + 1}: ${result.error?.message || result.stderr}`);
      const actual = JSON.parse(result.stdout);
      assert.equal(actual.answer, normalized.answer, `App answer mismatch at row ${index + 1}`);
      assert.equal(actual.reviewReason, normalized.reviewReason, `App review mismatch at row ${index + 1}`);
    }
    const seconds = (Date.now() - started) / 1000;
    const assessment = assess(normalized.answer);
    report.push({ row: index + 1, question, reference: row[referenceCol], raw, ...normalized, assessment, seconds, referenceChecks });
    XLSX.utils.sheet_add_aoa(sheet, [[normalized.answer]], { origin: { r: index, c: targetCol } });
    XLSX.utils.sheet_add_aoa(sheet, [[normalized.reviewReason, JSON.stringify(assessment), seconds]], { origin: { r: index, c: reviewCol } });
    fs.writeFileSync(path.join(outputDir, "results.json"), JSON.stringify(report, null, 2));
    XLSX.writeFile(workbook, path.join(outputDir, "Allwyn-tested.xlsx"));
    console.log(`row ${index + 1}: ${seconds.toFixed(1)}s | ${assessment.words} words | ${assessment.sections} sections | ${assessment.bullets} bullets | example=${assessment.example} | chatter=${assessment.chatter} | ${mode === "reference" ? `${referenceChecks} COPY CHECKS OK` : assessment.formatOK ? "FORMAT OK" : "FORMAT FAIL"}`);
  }
  console.log(mode === "reference"
    ? `${report.reduce((total, item) => total + item.referenceChecks, 0)} copy checks passed using all ${report.length} reference answers. References were not generated or fact-checked.`
    : `${report.filter((item) => item.assessment.formatOK).length}/${report.length} match Loopio structure; ${report.filter((item) => item.assessment.chatter).length} contain detected internal commentary. This is not factual verification.`);
}
