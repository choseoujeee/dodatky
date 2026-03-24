/**
 * Načte XLSX nebo CSV export ISRS do pole objektů (řádky = záznamy).
 */
import * as XLSX from "xlsx";

export async function parseSpreadsheetFile(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buf);
    const wb = XLSX.read(text, { type: "string", raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  }

  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}
