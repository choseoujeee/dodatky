/**
 * Mapování sloupců exportu, párování dodatků (ID návaznosti nebo heuristika) a agregace metrik.
 */
import {
  baseContractNo,
  cleanSubjectForMatch,
  extractContractIdsFromCell,
  isAddendumSod,
  isBaseSod,
  normalizeText,
  toNumber,
} from "./text";
import { sequenceRatio } from "./similarity";

export type MatchMethod =
  | "id-navaznost"
  | "no+supplier+subject"
  | "no+subject"
  | "no-only"
  | "scrape-parent-id"
  | "none";

export type ParsedRow = {
  city: string;
  supplier: string;
  subject: string;
  contractId: string;
  url: string;
  contractNo: string;
  priceNoVat: number | null;
  signDate: string;
  isAddendum: boolean;
  linkedIds: string[];
  supplierN: string;
  subjectMatch: string;
  baseNo: string;
};

export type ContractAggregateRow = {
  datasetLabel: string;
  city: string;
  supplier: string;
  subject: string;
  contractId: string;
  url: string;
  basePrice: number;
  addendaCount: number;
  addendaWithValueCount: number;
  addendaSum: number;
  finalPrice: number;
  deltaPct: number | null;
  matchMethod: MatchMethod;
  signDate: string;
  year: number | null;
  addendumUrls: string[];
};

/** Najde první sloupec, jehož normalizovaný název přesně odpoví cíli. */
function colExact(headers: string[], canonical: string): string | undefined {
  const t = normalizeText(canonical);
  return headers.find((h) => normalizeText(h) === t);
}

/** Sloupce s ID návazné smlouvy (více výskytů v Excelu = více klíčů). */
function findNavazneColumnKeys(headers: string[]): string[] {
  return headers.filter((h) => {
    const n = normalizeText(h);
    if (!n.includes("navaz")) return false;
    return true;
  });
}

function cellStr(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function parseRow(
  row: Record<string, unknown>,
  keys: {
    city: string;
    subject: string;
    url: string;
    id: string;
    contractNo: string;
    price: string;
    party: string;
    date: string;
    navKeys: string[];
  },
): ParsedRow | null {
  const subject = cellStr(row, keys.subject);
  const isBase = isBaseSod(subject);
  const isAdd = isAddendumSod(subject);
  if (!isBase && !isAdd) return null;

  const linkedIds: string[] = [];
  for (const nk of keys.navKeys) {
    linkedIds.push(...extractContractIdsFromCell(row[nk]));
  }

  const contractNo = cellStr(row, keys.contractNo);
  const supplier = cellStr(row, keys.party);

  return {
    city: cellStr(row, keys.city),
    supplier,
    subject,
    contractId: cellStr(row, keys.id),
    url: cellStr(row, keys.url),
    contractNo,
    priceNoVat: toNumber(row[keys.price]),
    signDate: cellStr(row, keys.date),
    isAddendum: isAdd,
    linkedIds,
    supplierN: normalizeText(supplier),
    subjectMatch: cleanSubjectForMatch(subject),
    baseNo: baseContractNo(contractNo),
  };
}

function parseYear(signDate: string): number | null {
  if (!signDate) return null;
  const d = new Date(signDate);
  if (!Number.isNaN(d.getTime())) return d.getFullYear();
  const m = signDate.match(/(\d{4})/);
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Z surových řádků XLSX vytáhne parsované záznamy SOD / dodatků. */
export function extractParsedRows(rawRows: Record<string, unknown>[]): {
  rows: ParsedRow[];
  navColumnKeys: string[];
} {
  if (rawRows.length === 0) return { rows: [], navColumnKeys: [] };
  const headers = Object.keys(rawRows[0]);
  const navKeys = findNavazneColumnKeys(headers);

  const city = colExact(headers, "Publikující smluvní strana");
  const subject = colExact(headers, "Textové označení smlouvy");
  const url = colExact(headers, "Adresa záznamu");
  const id = colExact(headers, "ID smlouvy");
  const contractNo = colExact(headers, "Číslo smlouvy / č. j.");
  const price = colExact(headers, "Hodnota smlouvy bez DPH");
  const party = colExact(headers, "Název protistrany č. 1");
  const date = colExact(headers, "Datum uzavření");

  const required = [city, subject, url, id, contractNo, price, party, date];
  if (required.some((x) => !x)) {
    throw new Error(
      "V souboru chybí očekávané sloupce exportu ISRS (zkontrolujte, že jde o standardní export).",
    );
  }

  const keyObj = {
    city: city!,
    subject: subject!,
    url: url!,
    id: id!,
    contractNo: contractNo!,
    price: price!,
    party: party!,
    date: date!,
    navKeys: navKeys,
  };

  const rows: ParsedRow[] = [];
  for (const r of rawRows) {
    const p = parseRow(r, keyObj);
    if (p) rows.push(p);
  }

  return {
    rows,
    navColumnKeys: navKeys,
  };
}

function aggregateDeterministic(
  parsed: ParsedRow[],
  datasetLabel: string,
  minBasePrice: number,
): ContractAggregateRow[] {
  const bases = parsed.filter((r) => !r.isAddendum && isBaseSod(r.subject));
  const adds = parsed.filter((r) => r.isAddendum);

  const out: ContractAggregateRow[] = [];

  for (const base of bases) {
    if (!base.contractId) continue;
    const selected = adds.filter(
      (a) => a.linkedIds.length > 0 && a.linkedIds.includes(base.contractId),
    );
    const matchMethod: MatchMethod = selected.length > 0 ? "id-navaznost" : "none";

    let addendaSum = 0;
    let addendaWithValueCount = 0;
    const addendumUrls: string[] = [];
    for (const a of selected) {
      if (a.priceNoVat !== null) {
        addendaSum += a.priceNoVat;
        addendaWithValueCount += 1;
      }
      if (a.url) addendumUrls.push(a.url);
    }

    const basePrice = base.priceNoVat ?? 0;
    if (basePrice < minBasePrice) continue;

    const finalPrice = basePrice + addendaSum;
    const deltaPct = basePrice !== 0 ? ((finalPrice - basePrice) / basePrice) * 100 : null;

    out.push({
      datasetLabel,
      city: base.city,
      supplier: base.supplier,
      subject: base.subject,
      contractId: base.contractId,
      url: base.url,
      basePrice,
      addendaCount: selected.length,
      addendaWithValueCount,
      addendaSum,
      finalPrice,
      deltaPct,
      matchMethod,
      signDate: base.signDate,
      year: parseYear(base.signDate),
      addendumUrls,
    });
  }

  return out;
}

type AddRecord = ParsedRow;

function aggregateHeuristic(
  parsed: ParsedRow[],
  datasetLabel: string,
  minBasePrice: number,
): ContractAggregateRow[] {
  const baseDf = parsed.filter((r) => !r.isAddendum);
  const addDf = parsed.filter((r) => r.isAddendum);
  const addRecords: AddRecord[] = addDf.map((a) => ({ ...a }));
  const usedAddIds = new Set<string>();

  const out: ContractAggregateRow[] = [];

  for (const base of baseDf) {
    const baseNo = String(base.baseNo || "");
    const baseSup = String(base.supplierN || "");
    const baseSubj = String(base.subjectMatch || "");

    const candidates = addRecords.filter(
      (a) => String(a.baseNo || "") === baseNo && !usedAddIds.has(a.contractId),
    );
    let selected: AddRecord[] = [];
    let matchMethod: MatchMethod = "none";

    if (candidates.length > 0) {
      const scored: {
        score: number;
        sim: number;
        supplierOk: boolean;
        a: AddRecord;
      }[] = [];
      for (const a of candidates) {
        const sim = sequenceRatio(baseSubj, String(a.subjectMatch || ""));
        const supplierOk = Boolean(a.supplierN && a.supplierN === baseSup);
        const score = sim + (supplierOk ? 0.35 : 0);
        scored.push({ score, sim, supplierOk, a });
      }

      const strong = scored.filter((x) => x.sim >= 0.55 && x.supplierOk);
      if (strong.length > 0) {
        selected = strong.map((x) => x.a);
        matchMethod = "no+supplier+subject";
      } else {
        const mid = scored.filter((x) => x.sim >= 0.65);
        if (mid.length > 0) {
          selected = mid.map((x) => x.a);
          matchMethod = "no+subject";
        } else {
          selected = scored.map((x) => x.a);
          matchMethod = "no-only";
        }
      }
    }

    for (const a of selected) {
      usedAddIds.add(a.contractId);
    }

    let addendaSum = 0;
    let addendaWithValueCount = 0;
    const addendumUrls: string[] = [];
    for (const a of selected) {
      if (a.priceNoVat !== null) {
        addendaSum += a.priceNoVat;
        addendaWithValueCount += 1;
      }
      if (a.url) addendumUrls.push(a.url);
    }

    const basePrice = base.priceNoVat ?? 0;
    if (basePrice < minBasePrice) continue;

    const finalPrice = basePrice + addendaSum;
    const deltaPct = basePrice !== 0 ? ((finalPrice - basePrice) / basePrice) * 100 : null;

    out.push({
      datasetLabel,
      city: base.city,
      supplier: base.supplier,
      subject: base.subject,
      contractId: base.contractId,
      url: base.url,
      basePrice,
      addendaCount: selected.length,
      addendaWithValueCount,
      addendaSum,
      finalPrice,
      deltaPct,
      matchMethod: selected.length === 0 ? "none" : matchMethod,
      signDate: base.signDate,
      year: parseYear(base.signDate),
      addendumUrls,
    });
  }

  return out;
}

function aggregateFromScrapeParentMap(
  parsed: ParsedRow[],
  datasetLabel: string,
  minBasePrice: number,
  parentIdByAddendumContractId: Record<string, string>,
): ContractAggregateRow[] {
  const bases = parsed.filter((r) => !r.isAddendum && isBaseSod(r.subject));
  const adds = parsed.filter((r) => r.isAddendum);

  const out: ContractAggregateRow[] = [];

  for (const base of bases) {
    if (!base.contractId) continue;

    const selected = adds.filter((a) => {
      const parentId = parentIdByAddendumContractId[a.contractId];
      return Boolean(parentId && parentId === base.contractId);
    });

    let addendaSum = 0;
    let addendaWithValueCount = 0;
    const addendumUrls: string[] = [];

    for (const a of selected) {
      if (a.priceNoVat !== null) {
        addendaSum += a.priceNoVat;
        addendaWithValueCount += 1;
      }
      if (a.url) addendumUrls.push(a.url);
    }

    const basePrice = base.priceNoVat ?? 0;
    if (basePrice < minBasePrice) continue;

    const finalPrice = basePrice + addendaSum;
    const deltaPct = basePrice !== 0 ? ((finalPrice - basePrice) / basePrice) * 100 : null;

    out.push({
      datasetLabel,
      city: base.city,
      supplier: base.supplier,
      subject: base.subject,
      contractId: base.contractId,
      url: base.url,
      basePrice,
      addendaCount: selected.length,
      addendaWithValueCount,
      addendaSum,
      finalPrice,
      deltaPct,
      matchMethod: selected.length > 0 ? "scrape-parent-id" : "none",
      signDate: base.signDate,
      year: parseYear(base.signDate),
      addendumUrls,
    });
  }

  return out;
}

/**
 * Hlavní vstup: surové řádky z exportu → agregované kmenové smlouvy s dodatky.
 */
export function buildAggregates(
  rawRows: Record<string, unknown>[],
  datasetLabel: string,
  minBasePrice: number,
  options: {
    forceHeuristic: boolean;
    scrapeParentMap?: Record<string, string>;
  },
): {
  aggregates: ContractAggregateRow[];
  navColumnKeys: string[];
  usedHeuristicOnly: boolean;
} {
  const { rows, navColumnKeys } = extractParsedRows(rawRows);
  const hasNav = navColumnKeys.length > 0;

  const scrapeParentMap = options.scrapeParentMap;
  const hasScrapeMap =
    scrapeParentMap && Object.keys(scrapeParentMap).length > 0 && typeof scrapeParentMap === "object";

  if (hasScrapeMap) {
    const agg = aggregateFromScrapeParentMap(
      rows,
      datasetLabel,
      minBasePrice,
      scrapeParentMap as Record<string, string>,
    );
    return { aggregates: agg, navColumnKeys, usedHeuristicOnly: false };
  }

  if (hasNav && !options.forceHeuristic) {
    const agg = aggregateDeterministic(rows, datasetLabel, minBasePrice);
    return { aggregates: agg, navColumnKeys, usedHeuristicOnly: false };
  }

  const agg = aggregateHeuristic(rows, datasetLabel, minBasePrice);
  return { aggregates: agg, navColumnKeys, usedHeuristicOnly: !hasNav };
}
