// Runs an RFI workbook through the same path as the hosted Batch:
// KA /api/chat (raw text, like the browser extension) -> /api/ask (normalization)
// and writes answers + review with the package-preserving XLSX exporter.
// Usage: node scripts/evaluate-rfi.cjs INPUT.xlsx NEW_OUTPUT_DIR [mode] [answerColLetter]
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const XLSX = require("xlsx");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);

const { buildKaUserContent } = require("../src/lib/promptMapping.ts");
const { updateOriginalXlsx } = require("../src/lib/xlsxPreserve.ts");
const { normalizeBridgedKaResponse } = require("../src/lib/providers/ka.ts");
const { hasSubstantiveAnswer } = require("../src/lib/responsePolicy.ts");

// APP_URL=inprocess runs the same normalization as /api/ask without a dev server.
function askApp(body) {
  if (process.env.APP_URL !== "inprocess") return curlJson(appEndpoint, body, 240);
  try {
    const r = normalizeBridgedKaResponse(body.localKaResponse, { question: body.question, mode: body.mode, confidenceReview: true, recovery: body.recovery });
    if (!hasSubstantiveAnswer(r.answer)) {
      const noAnswer = /^NO_ANSWER:/.test(r.reviewReason ?? "");
      return { status: 422, text: JSON.stringify({ error: noAnswer ? "The Knowledge Assistant found no supported answer (NO_ANSWER)." : "No usable answer.", reviewReason: r.reviewReason }) };
    }
    return { status: 200, text: JSON.stringify({ ok: true, answer: r.answer, tools: r.sourcesText || "knowledge_assistant", reviewRequired: r.reviewRequired, reviewReason: r.reviewReason }) };
  } catch (err) {
    return { status: err.status ?? 500, text: JSON.stringify({ error: err.message }) };
  }
}

const [input, outputDir, mode = "loopio", answerLetter = "C"] = process.argv.slice(2);
if (!input || !outputDir) throw new Error("Usage: node scripts/evaluate-rfi.cjs INPUT.xlsx NEW_OUTPUT_DIR [mode] [answerCol]");
fs.mkdirSync(outputDir);

const kaEndpoint = `${(process.env.KA_URL || "https://dy-knowledge-assistant.use1.dynamicyield.com").replace(/\/$/, "")}/api/chat`;
const appEndpoint = `${process.env.APP_URL || "http://localhost:3000"}/api/ask`;

function curlJson(url, body, timeout) {
  const r = spawnSync("curl", ["-sS", "-m", String(timeout), "-X", "POST", url, "-H", "content-type: application/json", "--data-binary", "@-", "-w", "\n%{http_code}"], {
    input: JSON.stringify(body), encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || `curl exit ${r.status}`);
  const idx = r.stdout.lastIndexOf("\n");
  return { status: Number(r.stdout.slice(idx + 1)), text: r.stdout.slice(0, idx) };
}

(async () => {
  const original = fs.readFileSync(input);
  const wb = XLSX.read(original, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const { sheetToMatrix } = require("../src/lib/sheetMatrix.ts");
  const matrix = sheetToMatrix(wb.Sheets[sheetName]);
  const answerCol = XLSX.utils.decode_col(answerLetter);
  const reviewCol = process.env.REVIEW_COL ? XLSX.utils.decode_col(process.env.REVIEW_COL) : Math.max(...matrix.map((r) => r.length), answerCol + 1);
  const results = [];
  // RAW_FROM=results.json reuses saved KA responses (re-normalization only).
  const cached = process.env.RAW_FROM
    ? Object.fromEntries(JSON.parse(fs.readFileSync(process.env.RAW_FROM, "utf8")).map((e) => [e.row, e]))
    : {};
  const qColH = XLSX.utils.decode_col(process.env.QUESTION_COL || "A");
  const headerRow = Math.max(0, matrix.findIndex((row) => String(row[qColH] ?? "").trim()));
  const edits = [{ row: headerRow, column: reviewCol, value: "Review" }];
  if (!String(matrix[headerRow][answerCol] ?? "").trim()) edits.push({ row: headerRow, column: answerCol, value: "Answer" });

  // QUESTION_COL (letter) lets workbooks keep questions outside column A.
  const qCol = XLSX.utils.decode_col(process.env.QUESTION_COL || "A");
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const question = String(matrix[r][qCol] ?? "").trim();
    const isHeading = qCol === 0 && question && !/\n/.test(question) && !String(matrix[r][1] ?? "").trim();
    if (!question || isHeading) continue;
    const started = Date.now();
    const entry = { row: r + 1, title: question.split(/\r?\n/)[0].slice(0, 60), question, reference: qCol === 0 ? String(matrix[r][1] ?? "") : "" };
    process.stdout.write(`row ${r + 1} ${entry.title} ... `);
    try {
      const only = process.env.ONLY_ROWS ? process.env.ONLY_ROWS.split(",").map(Number) : null;
      if (only && !only.includes(r + 1)) { process.stdout.write("skipped\n"); continue; }
      // Same flow as the Batch: first attempt, then ONE recovery attempt on 422.
      const attemptOnce = (recovery) => {
        const content = buildKaUserContent(question, { mode, confidenceReview: true, recovery });
        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
          res = curlJson(kaEndpoint, { messages: [{ role: "user", content }] }, 240);
          if (res.status === 200) break;
        }
        if (res.status !== 200) throw new Error(`KA HTTP ${res.status}`);
        const app = askApp({ question, mode, backend: "ka", confidenceReview: true, localKaResponse: res.text, recovery });
        return { raw: res.text, app, data: JSON.parse(app.text) };
      };
      if (!process.env.RAW_FROM) {
        let out = attemptOnce(false);
        entry.attempts = 1;
        if (out.app.status === 422) { out = attemptOnce(true); entry.attempts = 2; }
        entry.kaStatus = 200; entry.raw = out.raw; entry.appStatus = out.app.status;
        const data = out.data;
        entry.answer = data.answer ?? ""; entry.error = data.error; entry.sources = data.tools ?? "";
        entry.reviewRequired = Boolean(data.reviewRequired);
        entry.review = data.reviewRequired ? data.reviewReason : (data.error ? data.reviewReason || data.error : "");
        throw { skipToEnd: true };
      }
      const content = buildKaUserContent(question, { mode, confidenceReview: true });
      let ka = cached[r + 1]?.kaStatus === 200 ? { status: 200, text: cached[r + 1].raw } : undefined;
      for (let attempt = 0; !ka && attempt < 3 || ka && ka.status !== 200 && attempt < 3; attempt++) {
        ka = curlJson(kaEndpoint, { messages: [{ role: "user", content }] }, 240);
        if (ka.status === 200) break;
        await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
      }
      entry.kaStatus = ka.status;
      entry.raw = ka.text;
      if (ka.status !== 200) throw new Error(`KA HTTP ${ka.status}`);
      const replayRecovery = cached[r + 1]?.attempts === 2;
      entry.attempts = replayRecovery ? 2 : 1;
      const app = askApp({ question, mode, backend: "ka", confidenceReview: true, localKaResponse: ka.text, recovery: replayRecovery });
      const data = JSON.parse(app.text);
      entry.appStatus = app.status;
      entry.answer = data.answer ?? "";
      entry.error = data.error;
      entry.sources = data.tools ?? "";
      entry.reviewRequired = Boolean(data.reviewRequired);
      entry.review = data.reviewRequired ? data.reviewReason : (data.error ? data.reviewReason || data.error : "");
    } catch (err) {
      if (!err?.skipToEnd) {
        entry.error = err.message;
        entry.review = err.message;
      }
    }
    entry.seconds = Math.round((Date.now() - started) / 1000);
    results.push(entry);
    edits.push({ row: r, column: answerCol, value: entry.answer ?? "" });
    edits.push({ row: r, column: reviewCol, value: entry.review ?? "" });
    console.log(`${entry.error ? "ERROR " + entry.error.slice(0, 80) : "ok"} · ${entry.seconds}s · review=${entry.reviewRequired ? "yes" : "no"} · attempts=${entry.attempts ?? 1} · sources=${(entry.sources || "").split(";").filter((s) => /http/.test(s)).length}`);
    fs.writeFileSync(path.join(outputDir, "results.json"), JSON.stringify(results, null, 2));
  }

  const out = await updateOriginalXlsx(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength), sheetName, edits, [{ column: reviewCol, width: 45 }, ...(!String(matrix[headerRow][answerCol] ?? "").trim() ? [{ column: answerCol, width: 80 }] : [])]);
  const outName = path.basename(input).replace(/\.xlsx$/i, "") + "_answered.xlsx";
  fs.writeFileSync(path.join(outputDir, outName), Buffer.from(out));
  console.log(`\nWrote ${path.join(outputDir, outName)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
