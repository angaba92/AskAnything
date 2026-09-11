const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const [input, baseReport, rerunReport, output] = process.argv.slice(2);
if (!input || !baseReport || !rerunReport || !output) {
  throw new Error("Usage: node scripts/merge-requirement-results.cjs INPUT.xlsx BASE.json RERUN.json OUTPUT.xlsx");
}
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);

const workbook = XLSX.readFile(input, { cellFormula: true, cellStyles: true });
const original = XLSX.readFile(input, { cellFormula: true, cellStyles: true });
const base = JSON.parse(fs.readFileSync(baseReport, "utf8")).results;
const reruns = JSON.parse(fs.readFileSync(rerunReport, "utf8")).results;
const merged = new Map(base.map((item) => [item.id, item]));
for (const item of reruns) merged.set(item.id, item);
assert.equal(merged.size, base.length, "A rerun ID was not present in the base selection.");

for (const sheetName of workbook.SheetNames.slice(1)) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headerRow = grid.findIndex((row) => row.includes("ID") && row.includes("Supplier Response"));
  if (headerRow < 0) throw new Error(`Could not find headers in ${sheetName}`);
  const idColumn = grid[headerRow].indexOf("ID");
  const outputColumn = range.e.c + 1;
  XLSX.utils.sheet_add_aoa(sheet, [[
    "Test Supplier Response",
    "Test Needs Review",
    "Test Diagnostics",
    "Test Duration (s)",
  ]], { origin: { r: headerRow, c: outputColumn } });
  for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex++) {
    const id = String(grid[rowIndex][idColumn] || "").trim();
    const item = merged.get(id);
    if (!item) continue;
    XLSX.utils.sheet_add_aoa(sheet, [[
      item.answer,
      item.reviewReason,
      item.error ? `ERROR: ${item.error}` : JSON.stringify(item.assessment),
      item.seconds,
    ]], { origin: { r: rowIndex, c: outputColumn } });
  }
}

const summaryRows = [[
  "Sheet", "ID", "Theme", "Title", "Result", "Words", "Bullets",
  "Needs Review", "Structural Issues", "Review Reason", "Duration (s)",
]];
for (const item of merged.values()) {
  summaryRows.push([
    item.sheetName,
    item.id,
    item.theme,
    item.title,
    item.error ? "ERROR" : item.assessment.pass ? "PASS" : "REVIEW",
    item.assessment?.words ?? "",
    item.assessment?.bullets ?? "",
    item.reviewRequired ? "Yes" : "No",
    item.assessment?.issues?.join("; ") ?? "",
    item.reviewReason,
    item.seconds,
  ]);
}
const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
summarySheet["!cols"] = [
  { wch: 22 }, { wch: 12 }, { wch: 38 }, { wch: 38 }, { wch: 10 },
  { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 50 }, { wch: 70 }, { wch: 14 },
];
XLSX.utils.book_append_sheet(workbook, summarySheet, "Test Summary");
XLSX.writeFile(workbook, output, { cellStyles: true });

const written = XLSX.readFile(output, { cellFormula: true });
for (const sheetName of original.SheetNames) {
  for (const [address, cell] of Object.entries(original.Sheets[sheetName])) {
    if (address.startsWith("!")) continue;
    assert.equal(written.Sheets[sheetName][address]?.v, cell.v, `${sheetName}!${address} value changed`);
    assert.equal(written.Sheets[sheetName][address]?.f, cell.f, `${sheetName}!${address} formula changed`);
  }
}
assert.equal(summaryRows.length, base.length + 1);
console.log(`Merged ${reruns.length} reruns into ${base.length} test rows; original values/formulas preserved.`);
