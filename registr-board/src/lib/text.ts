/**
 * Normalizace textu pro porovnání názvů sloupců a podobnost řetězců (bez diakritiky, lower).
 */
export function normalizeText(value: string): string {
  const text = value.normalize("NFD").replace(/\p{M}/gu, "");
  return text.toLowerCase().trim();
}

/** Parsování českého čísla z buňky exportu ISRS. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  let s = String(value).trim().replace(/\s/g, "").replace(/\u00a0/g, "");
  s = s.replace(",", ".");
  if (s === "" || normalizeText(s).includes("neuvedeno")) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Z čísla typu '459/1S/2025/dodatek č. 3' vrátí kmenové číslo před '/dodatek'.
 */
export function baseContractNo(contractNo: string): string {
  if (!contractNo) return "";
  const raw = String(contractNo).trim();
  const norm = normalizeText(raw);
  const idx = norm.indexOf("/dodatek");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw;
}

/** Očistí název pro fuzzy shodu (odstraní prefix dodatku). */
export function cleanSubjectForMatch(subject: string): string {
  let s = normalizeText(subject);
  s = s.replace(/dodatek\s*c\.\s*\d+\s*ke\s*/g, "");
  s = s.replace(/^dodatek\s*ke\s*/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function isBaseSod(subject: string): boolean {
  const s = normalizeText(subject);
  return s.startsWith("smlouva o dilo");
}

export function isAddendumSod(subject: string): boolean {
  const s = normalizeText(subject);
  return s.includes("dodatek") && s.includes("smlouv") && s.includes("o dilo");
}

/** Z buňky vytáhne číselné ID smlouvy (řetězec číslic). */
export function extractContractIdsFromCell(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const s = String(value).trim();
  if (!s) return [];
  const parts = s.split(/[;,/\s]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) out.push(p);
  }
  if (out.length === 0 && /^\d+$/.test(s)) out.push(s);
  return out;
}
