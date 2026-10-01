import * as XLSX from "xlsx";

/**
 * Matriz de celdas anclada SIEMPRE en A1. sheet_to_json empieza por defecto en
 * el rango usado (p. ej. B3), lo que desplazaba filas/columnas: las letras
 * mostradas no coincidían y la exportación escribía en filas equivocadas.
 */
export function sheetToMatrix(ws: XLSX.WorkSheet | undefined): string[][] {
  if (!ws || !ws["!ref"]) return [];
  const used = XLSX.utils.decode_range(ws["!ref"]);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: used.e },
  }).map((row) => row.map((cell) => String(cell ?? "")));
}
