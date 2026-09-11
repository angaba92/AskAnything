const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const XLSX = require("xlsx");
const JSZip = require("jszip");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);

const { updateOriginalXlsx } = require("../src/lib/xlsxPreserve.ts");

async function fixture() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Question", "Answer"],
    ["How?", "Old"],
    ["Why?", ""],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Styled & Special");
  const generated = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const zip = await JSZip.loadAsync(generated);
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheetId = /<sheet\b[^>]*name="Styled &amp; Special"[^>]*r:id="([^"]+)"/.exec(workbookXml)[1];
  const target = new RegExp(`<Relationship\\b[^>]*Id="${sheetId}"[^>]*Target="([^"]+)"`).exec(rels)[1];
  const sheetPath = `xl/${target}`;
  let xml = await zip.file(sheetPath).async("string");
  xml = xml.replace(/<c r="B2"/, '<c r="B2" s="7"');
  zip.file(sheetPath, xml);
  zip.file("customXml/preserve-me.xml", "<preserve>metadata</preserve>");
  zip.file("xl/media/preserve-me.png", Uint8Array.from([1, 2, 3, 4]));
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    sheetPath,
  };
}

test("XLSX export changes only worksheet XML and preserves package parts and cell styles", async () => {
  const { bytes, sheetPath } = await fixture();
  const before = await JSZip.loadAsync(bytes);
  const output = await updateOriginalXlsx(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "Styled & Special",
    [
      { row: 1, column: 1, value: "New & <safe>\nline" },
      { row: 2, column: 2, value: "Needs review" },
    ],
    [{ column: 2, width: 45 }],
  );
  const after = await JSZip.loadAsync(output);
  assert.deepEqual(
    Object.keys(after.files).filter((name) => !after.files[name].dir).sort(),
    Object.keys(before.files).filter((name) => !before.files[name].dir).sort(),
  );
  for (const name of Object.keys(before.files)) {
    if (name === sheetPath || before.files[name].dir) continue;
    assert.deepEqual(
      Buffer.from(await after.file(name).async("uint8array")),
      Buffer.from(await before.file(name).async("uint8array")),
      name,
    );
  }
  const xml = await after.file(sheetPath).async("string");
  assert.match(xml, /<c r="B2" s="7" t="inlineStr">/);
  assert.match(xml, /New &amp; &lt;safe&gt;\nline/);
  assert.match(xml, /<c r="C3"[^>]*t="inlineStr">/);
  assert.match(xml, /<dimension ref="A1:C3"\/>/);
  assert.match(xml, /<col min="3" max="3" width="45" customWidth="1"\/>/);
  const parsed = XLSX.read(output, { type: "array" });
  assert.equal(parsed.Sheets["Styled & Special"].B2.v, "New & <safe>\nline");
  assert.equal(parsed.Sheets["Styled & Special"].C3.v, "Needs review");
});

test("real complex workbook retains every package part after a cell update", async (t) => {
  const input = process.env.FORMAT_TEST_XLSX;
  if (!input || !fs.existsSync(input)) return t.skip("FORMAT_TEST_XLSX not provided");
  const bytes = fs.readFileSync(input);
  const before = await JSZip.loadAsync(bytes);
  const output = await updateOriginalXlsx(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "Lot 1",
    [{ row: 6, column: 5, value: "Preservation test" }],
  );
  const after = await JSZip.loadAsync(output);
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  for (const required of [
    "xl/drawings/drawing1.xml",
    "xl/comments1.xml",
    "xl/media/image1.png",
    "docMetadata/LabelInfo.xml",
    "customXml/item1.xml",
  ]) assert.ok(after.file(required), required);
  const temporary = path.join(os.tmpdir(), `preserved-${process.pid}.xlsx`);
  fs.writeFileSync(temporary, output);
  const parsed = XLSX.readFile(temporary);
  fs.unlinkSync(temporary);
  assert.equal(parsed.Sheets["Lot 1"].F7.v, "Preservation test");
});
