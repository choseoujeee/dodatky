import { getStore } from "@netlify/blobs";

type AddendumItem = {
  addendumContractId: string;
  url: string;
};

type JobStatus = {
  jobId: string;
  status: "running" | "done" | "failed";
  total: number;
  processed: number;
  startedAt: number;
  finishedAt?: number;
  // Deterministické mapování: id dod. smlouvy -> id kmenové smlouvy
  mapping?: Record<string, string>;
  errors?: Array<{ addendumContractId?: string; url?: string; reason: string }>;
};

const CACHE_STORE = "registr-scrape-cache";
const JOB_STORE = "registr-scrape-jobs";

function normalizeForSearch(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/gi, " ")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/[ \t]+/g, " ");
}

function extractFirstNumberAfterLabel(text: string, label: string): string | null {
  const normText = normalizeForSearch(text);
  const normLabel = normalizeForSearch(label);
  const idx = normText.indexOf(normLabel);
  if (idx < 0) return null;

  const after = normText.slice(idx + normLabel.length, idx + normLabel.length + 800);
  const m = after.match(/(\d{5,})/);
  return m?.[1] ?? null;
}

function extractAddendumAndParentIds(html: string): {
  addendumContractId: string | null;
  parentContractId: string | null;
} {
  const text = stripHtmlToText(html);

  // Tyto labely odpovídají tomu, jak je parser dělal v `scrape_registr_smluv.py`.
  const scrapedAddendumId = extractFirstNumberAfterLabel(text, "id smlouvy");
  const scrapedParentId = extractFirstNumberAfterLabel(text, "id navazne smlouvy");

  return { addendumContractId: scrapedAddendumId, parentContractId: scrapedParentId };
}

async function fetchHtml(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (RegistrScrape; netlify background job)",
        "accept-language": "cs,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export default async (req: Request): Promise<void> => {
  const body = await req.json().catch(() => null);
  const jobId = body?.jobId;
  const addenda = body?.addenda as AddendumItem[] | undefined;

  if (!jobId || !Array.isArray(addenda)) {
    // Background funkce ignoruje výsledek na klientovi, ale pro logy je to důležité.
    console.log("scrape-addenda-background: invalid input", { jobId, hasAddenda: Array.isArray(addenda) });
    return;
  }

  const cache = getStore(CACHE_STORE);
  const jobs = getStore(JOB_STORE);

  const startedAt = Date.now();
  const jobKey = `job:${jobId}`;

  const status: JobStatus = {
    jobId,
    status: "running",
    total: addenda.length,
    processed: 0,
    startedAt,
    errors: [],
  };

  await jobs.setJSON(jobKey, status);

  // Výkon + šetrnost: limit paralelních requestů a cache.
  const concurrency = Math.max(2, Math.min(12, body?.concurrency ?? 8));

  let processed = 0;
  const mapping: Record<string, string> = {};
  const errors: JobStatus["errors"] = [];

  let nextIndex = 0;
  let lastPersistAt = Date.now();

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= addenda.length) return;

      const item = addenda[i];
      const addendumContractId = String(item.addendumContractId || "").trim();
      const url = String(item.url || "").trim();

      try {
        if (!addendumContractId || !url) {
          throw new Error("missing addendumContractId or url");
        }

        const cacheKey = `addendum-parent:${addendumContractId}`;
        const cached = await cache.get(cacheKey, { type: "json" }).catch(() => null);
        if (cached && typeof cached?.parentContractId === "string" && cached.parentContractId) {
          mapping[addendumContractId] = cached.parentContractId;
        } else {
          const html = await fetchHtml(url);
          const { addendumContractId: scrapedId, parentContractId } = extractAddendumAndParentIds(html);

          if (!parentContractId) {
            throw new Error("missing id navazne smlouvy");
          }

          // Ověřovací sanity-check: id smlouvy by mělo odpovídat URL/řádku.
          if (scrapedId && scrapedId !== addendumContractId) {
            errors?.push({
              addendumContractId,
              url,
              reason: `id smlouvy mismatch (expected ${addendumContractId}, got ${scrapedId})`,
            });
          }

          mapping[addendumContractId] = parentContractId;
          await cache.setJSON(cacheKey, { parentContractId });
        }
      } catch (e) {
        errors?.push({
          addendumContractId,
          url,
          reason: e instanceof Error ? e.message : String(e),
        });
      } finally {
        processed += 1;
        const now = Date.now();
        const shouldPersist = processed % 10 === 0 || now - lastPersistAt > 8_000;
        if (shouldPersist) {
          lastPersistAt = now;
          await jobs.setJSON(jobKey, {
            ...status,
            processed,
            errors: errors?.slice(-50),
          });
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  await jobs.setJSON(jobKey, {
    jobId,
    status: "done",
    total: addenda.length,
    processed,
    startedAt,
    finishedAt: Date.now(),
    mapping,
    errors,
  });
};

