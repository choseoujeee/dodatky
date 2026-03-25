import { getStore } from "@netlify/blobs";

type AddendaScrapeResult = {
  jobId: string;
  status: "running" | "done" | "failed";
  total: number;
  processed: number;
  startedAt: number;
  finishedAt?: number;
  mapping?: Record<string, string>;
  errors?: Array<{ addendumContractId?: string; url?: string; reason: string }>;
};

const JOB_STORE = "registr-scrape-jobs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let jobId: string | null = null;
  const url = new URL(req.url);
  jobId = url.searchParams.get("jobId");

  if (!jobId) {
    try {
      const body = await req.json();
      jobId = body?.jobId ?? null;
    } catch {
      // ignore
    }
  }

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Missing jobId" }), {
      status: 400,
      headers: { ...corsHeaders(), "content-type": "application/json" },
    });
  }

  const jobs = getStore(JOB_STORE);
  const jobKey = `job:${jobId}`;
  const entry = (await jobs.get(jobKey, { type: "json" })) as AddendaScrapeResult | null;

  if (!entry) {
    return new Response(JSON.stringify({ error: "Unknown jobId" }), {
      status: 404,
      headers: { ...corsHeaders(), "content-type": "application/json" },
    });
  }

  const payload: AddendaScrapeResult = entry;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders(), "content-type": "application/json" },
  });
};

