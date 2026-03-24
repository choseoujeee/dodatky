/**
 * Ukládání sbírky měst do prohlížeče (localStorage) a záloha do souboru JSON.
 * Data neopouštějí počítač, pokud soubor neexportujete.
 */

export const STORAGE_KEY = "registr-board.v1";

export type StoredDataset = {
  id: string;
  /** Zobrazovaný název města / sady */
  label: string;
  /** Surové řádky exportu ISRS */
  raw: Record<string, unknown>[];
};

export type PersistedPayloadV1 = {
  version: 1;
  datasets: StoredDataset[];
  minBasePrice: number;
  forceHeuristic: boolean;
};

const DEFAULTS: PersistedPayloadV1 = {
  version: 1,
  datasets: [],
  minBasePrice: 500_000,
  forceHeuristic: false,
};

export function loadPersisted(): PersistedPayloadV1 {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    if (!s) return { ...DEFAULTS };
    const parsed = JSON.parse(s) as PersistedPayloadV1;
    if (parsed?.version !== 1 || !Array.isArray(parsed.datasets)) return { ...DEFAULTS };
    return {
      version: 1,
      datasets: parsed.datasets,
      minBasePrice:
        typeof parsed.minBasePrice === "number" ? parsed.minBasePrice : DEFAULTS.minBasePrice,
      forceHeuristic: Boolean(parsed.forceHeuristic),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePersisted(payload: PersistedPayloadV1): { ok: true } | { ok: false; message: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    const json = JSON.stringify(payload);
    window.localStorage.setItem(STORAGE_KEY, json);
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof DOMException && e.name === "QuotaExceededError"
        ? "Úložiště prohlížeče je plné. Smažte starší sady nebo použijte „Exportovat JSON“ a vyčistěte data."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, message: msg };
  }
}

export function downloadJson(filename: string, payload: PersistedPayloadV1): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function parseImportedPayload(file: File): Promise<PersistedPayloadV1> {
  const text = await file.text();
  const parsed = JSON.parse(text) as PersistedPayloadV1;
  if (parsed?.version !== 1 || !Array.isArray(parsed.datasets)) {
    throw new Error("Neplatný soubor — očekává se záloha registr-board (version 1).");
  }
  return {
    version: 1,
    datasets: parsed.datasets,
    minBasePrice:
      typeof parsed.minBasePrice === "number" ? parsed.minBasePrice : DEFAULTS.minBasePrice,
    forceHeuristic: Boolean(parsed.forceHeuristic),
  };
}
