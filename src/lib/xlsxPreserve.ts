import JSZip from "jszip";

export interface XlsxCellEdit {
  row: number;
  column: number;
  value: string;
}

export interface XlsxNewColumn {
  column: number;
  width: number;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function columnName(column: number): string {
  let value = column + 1;
  let output = "";
  while (value > 0) {
    value--;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function columnIndex(reference: string): number {
  let value = 0;
  for (const char of reference.match(/^[A-Z]+/)?.[0] || "") {
    value = value * 26 + char.charCodeAt(0) - 64;
  }
  return value - 1;
}

function replaceCell(rowXml: string, reference: string, value: string): string {
  const cellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>([\\s\\S]*?)<\\/c>|<c\\b([^>]*\\br="${reference}"[^>]*)\\/>`);
  const existing = cellPattern.exec(rowXml);
  const escaped = escapeXml(value);
  if (existing) {
    const attrs = (existing[1] || existing[3])
      .replace(/\s+t="[^"]*"/g, "");
    const replacement = `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
    return rowXml.slice(0, existing.index) + replacement + rowXml.slice(existing.index + existing[0].length);
  }

  const targetColumn = columnIndex(reference);
  const cellTags = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  const nearest = cellTags.reduce<{ distance: number; style?: string } | null>((best, match) => {
    const distance = Math.abs(columnIndex(match[1]) - targetColumn);
    const style = attribute(match[0], "s");
    return !best || distance < best.distance ? { distance, style } : best;
  }, null);
  const style = nearest?.style ? ` s="${nearest.style}"` : "";
  const cell = `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
  const later = cellTags.find((match) => columnIndex(match[1]) > targetColumn);
  if (later?.index !== undefined) {
    return rowXml.slice(0, later.index) + cell + rowXml.slice(later.index);
  }
  return rowXml.replace("</row>", `${cell}</row>`);
}

function updateCell(xml: string, edit: XlsxCellEdit): string {
  const rowNumber = edit.row + 1;
  const reference = `${columnName(edit.column)}${rowNumber}`;
  const rowPattern = new RegExp(`<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>`);
  const match = rowPattern.exec(xml);
  if (!match) throw new Error(`Worksheet row ${rowNumber} is missing.`);
  const replacement = replaceCell(match[0], reference, edit.value);
  return xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length);
}

function expandDimension(xml: string, edits: XlsxCellEdit[]): string {
  const match = /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/>/.exec(xml);
  if (!match) return xml;
  const [start, end = start] = match[1].split(":");
  const startMatch = /^([A-Z]+)(\d+)$/.exec(start);
  const endMatch = /^([A-Z]+)(\d+)$/.exec(end);
  if (!startMatch || !endMatch) return xml;
  let maxColumn = columnIndex(endMatch[1]);
  let maxRow = Number(endMatch[2]) - 1;
  for (const edit of edits) {
    maxColumn = Math.max(maxColumn, edit.column);
    maxRow = Math.max(maxRow, edit.row);
  }
  const next = `${start}:${columnName(maxColumn)}${maxRow + 1}`;
  return xml.replace(`ref="${match[1]}"`, `ref="${next}"`);
}

function addColumns(xml: string, columns: XlsxNewColumn[]): string {
  if (!columns.length) return xml;
  const tags = columns.map(({ column, width }) =>
    `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  if (/<cols>[\s\S]*?<\/cols>/.test(xml)) return xml.replace("</cols>", `${tags}</cols>`);
  if (/<sheetFormatPr\b[^>]*\/>/.test(xml)) {
    return xml.replace(/(<sheetFormatPr\b[^>]*\/>)/, `$1<cols>${tags}</cols>`);
  }
  return xml.replace("<sheetData>", `<cols>${tags}</cols><sheetData>`);
}

function sheetPath(workbookXml: string, relationsXml: string, sheetName: string): string {
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)]
    .map((match) => match[0])
    .find((tag) => decodeXml(attribute(tag, "name") || "") === sheetName);
  const relationshipId = sheetTag && attribute(sheetTag, "r:id");
  if (!relationshipId) throw new Error(`Worksheet "${sheetName}" was not found in the original XLSX.`);
  const relationship = [...relationsXml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((match) => match[0])
    .find((tag) => attribute(tag, "Id") === relationshipId);
  const target = relationship && attribute(relationship, "Target");
  if (!target) throw new Error(`Worksheet relationship "${relationshipId}" is missing.`);
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

export async function updateOriginalXlsx(
  original: ArrayBuffer,
  sheetName: string,
  edits: XlsxCellEdit[],
  newColumns: XlsxNewColumn[] = [],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(original);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relationsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relationsXml) throw new Error("The XLSX workbook metadata is incomplete.");
  const path = sheetPath(workbookXml, relationsXml, sheetName);
  const worksheet = zip.file(path);
  if (!worksheet) throw new Error(`The original worksheet package "${path}" is missing.`);
  let xml = await worksheet.async("string");
  for (const edit of edits) xml = updateCell(xml, edit);
  xml = addColumns(expandDimension(xml, edits), newColumns);
  zip.file(path, xml, { createFolders: false });
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
