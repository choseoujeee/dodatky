import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { computeMetrics, formatMoney, formatPct, type DatasetMetrics } from "./lib/metrics";
import {
  buildAggregates,
  type ContractAggregateRow,
  type MatchMethod,
} from "./lib/pairAndAggregate";
import { parseSpreadsheetFile } from "./lib/parseFile";
import { normalizeText } from "./lib/text";
import {
  downloadJson,
  loadPersisted,
  parseImportedPayload,
  savePersisted,
  type PersistedPayloadV1,
  type StoredDataset,
} from "./lib/storage";

type Dataset = {
  id: string;
  label: string;
  raw: Record<string, unknown>[];
  aggregates: ContractAggregateRow[];
  navColumnKeys: string[];
};

type Staged = {
  raw: Record<string, unknown>[];
  fileName: string;
  /** Návrh názvu — uživatel může upravit před uložením */
  labelDraft: string;
};

function methodLabel(m: MatchMethod): string {
  const map: Record<MatchMethod, string> = {
    "id-navaznost": "ID návazné smlouvy (deterministické)",
    "no+supplier+subject": "Číslo + dodavatel + podobnost názvu",
    "no+subject": "Číslo + podobnost názvu",
    "no-only": "Pouze číslo smlouvy",
    none: "Bez detekovaných dodatků",
  };
  return map[m] ?? m;
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function datasetsFromStored(
  stored: StoredDataset[],
  minBase: number,
  forceH: boolean,
): Dataset[] {
  return stored.map((s) => {
    const { aggregates, navColumnKeys } = buildAggregates(s.raw, s.label, minBase, {
      forceHeuristic: forceH,
    });
    return {
      id: s.id,
      label: s.label,
      raw: s.raw,
      aggregates,
      navColumnKeys,
    };
  });
}

function toPayload(datasets: Dataset[], minBasePrice: number, forceHeuristic: boolean): PersistedPayloadV1 {
  return {
    version: 1,
    datasets: datasets.map((d) => ({ id: d.id, label: d.label, raw: d.raw })),
    minBasePrice,
    forceHeuristic,
  };
}

function getInitialAppState(): {
  datasets: Dataset[];
  minBasePrice: number;
  forceHeuristic: boolean;
} {
  const p = loadPersisted();
  return {
    datasets: datasetsFromStored(p.datasets, p.minBasePrice, p.forceHeuristic),
    minBasePrice: p.minBasePrice,
    forceHeuristic: p.forceHeuristic,
  };
}

export function App() {
  const init = useRef(getInitialAppState());
  const [datasets, setDatasets] = useState<Dataset[]>(() => init.current.datasets);
  const [minBasePrice, setMinBasePrice] = useState(() => init.current.minBasePrice);
  const [forceHeuristic, setForceHeuristic] = useState(() => init.current.forceHeuristic);

  /** Náhled před uložením — po dropnutí souboru */
  const [staged, setStaged] = useState<Staged | null>(null);
  /** Upravený název města před uložením náhledu */
  const [stagedLabel, setStagedLabel] = useState("");

  const [yearFilter, setYearFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [outlierMinPct, setOutlierMinPct] = useState(30);
  const [strictKpiOnly, setStrictKpiOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "outliers">("all");
  const [sort, setSort] = useState<{ key: keyof ContractAggregateRow; dir: "asc" | "desc" }>({
    key: "deltaPct",
    dir: "desc",
  });
  const [error, setError] = useState<string | null>(null);
  const [persistHint, setPersistHint] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDatasets((ds) =>
      ds.map((d) => {
        const { aggregates, navColumnKeys } = buildAggregates(
          d.raw,
          d.label,
          minBasePrice,
          { forceHeuristic },
        );
        return { ...d, aggregates, navColumnKeys };
      }),
    );
  }, [minBasePrice, forceHeuristic]);

  useEffect(() => {
    const payload = toPayload(datasets, minBasePrice, forceHeuristic);
    const r = savePersisted(payload);
    if (!r.ok) setPersistHint(r.message);
    else setPersistHint(null);
  }, [datasets, minBasePrice, forceHeuristic]);

  const previewForStaged = useMemo(() => {
    if (!staged) return null;
    const label = stagedLabel.trim() || staged.labelDraft;
    const { aggregates } = buildAggregates(staged.raw, label, minBasePrice, { forceHeuristic });
    return { aggregates, label };
  }, [staged, stagedLabel, minBasePrice, forceHeuristic]);

  const stagedMetrics = useMemo(() => {
    if (!previewForStaged) return null;
    return computeMetrics(previewForStaged.aggregates, previewForStaged.label);
  }, [previewForStaged]);

  const processFile = async (file: File) => {
    setError(null);
    try {
      const raw = await parseSpreadsheetFile(file);
      const baseName = file.name.replace(/\.(xlsx|csv)$/i, "") || "Město";
      setStaged({ raw, fileName: file.name, labelDraft: baseName });
      setStagedLabel(baseName);
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFilesSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (files.length > 1) {
      setError("Nahrajte prosím jeden export najednou. Další město přidejte po uložení tohoto.");
    }
    void processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const saveStagedToCollection = () => {
    if (!staged) return;
    const label = stagedLabel.trim() || staged.labelDraft;
    if (!label.trim()) {
      setError("Vyplňte název města / sady před uložením.");
      return;
    }
    const { aggregates, navColumnKeys } = buildAggregates(staged.raw, label, minBasePrice, {
      forceHeuristic,
    });
    setDatasets((ds) => [
      ...ds,
      { id: nextId(), label, raw: staged.raw, aggregates, navColumnKeys },
    ]);
    setStaged(null);
    setStagedLabel("");
    setError(null);
    setPage(0);
  };

  const discardStaged = () => {
    setStaged(null);
    setStagedLabel("");
    setError(null);
  };

  const removeDataset = (id: string) => {
    setDatasets((ds) => ds.filter((d) => d.id !== id));
    setPage(0);
  };

  const exportBackup = () => {
    const name = `registr-board-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(name, toPayload(datasets, minBasePrice, forceHeuristic));
  };

  const onImportFile = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setError(null);
    try {
      const payload = await parseImportedPayload(files[0]);
      const replace = window.confirm(
        "Nahradit všechna aktuální data zálohou?\n\nOK = nahradit\nZrušit = připojit města ze zálohy k už uloženým",
      );
      if (replace) {
        setDatasets(datasetsFromStored(payload.datasets, payload.minBasePrice, payload.forceHeuristic));
        setMinBasePrice(payload.minBasePrice);
        setForceHeuristic(payload.forceHeuristic);
      } else {
        const current = toPayload(datasets, minBasePrice, forceHeuristic).datasets;
        const appended: StoredDataset[] = payload.datasets.map((d) => ({
          id: nextId(),
          label: d.label,
          raw: d.raw,
        }));
        const merged: StoredDataset[] = [...current, ...appended];
        setDatasets(datasetsFromStored(merged, payload.minBasePrice, payload.forceHeuristic));
        setMinBasePrice(payload.minBasePrice);
        setForceHeuristic(payload.forceHeuristic);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (importInputRef.current) importInputRef.current.value = "";
  };

  const clearAll = () => {
    if (!window.confirm("Opravdu smazat všechna uložená města z tohoto prohlížeče?")) return;
    setDatasets([]);
    setStaged(null);
    setStagedLabel("");
  };

  const mergedRows = useMemo(() => {
    const yearN = yearFilter ? Number.parseInt(yearFilter, 10) : null;
    const q = normalizeText(search);
    const all: ContractAggregateRow[] = [];
    for (const d of datasets) {
      for (const r of d.aggregates) {
        if (yearN !== null && !Number.isNaN(yearN) && r.year !== yearN) continue;
        if (q) {
          const hay = normalizeText(`${r.subject} ${r.supplier} ${r.city}`);
          if (!hay.includes(q)) continue;
        }
        all.push(r);
      }
    }
    return all;
  }, [datasets, yearFilter, search]);

  const kpiRows = useMemo(() => {
    if (!strictKpiOnly) return mergedRows;
    return mergedRows.filter((r) => r.matchMethod === "id-navaznost");
  }, [mergedRows, strictKpiOnly]);

  const showStrictWarning =
    strictKpiOnly && mergedRows.some((r) => r.matchMethod === "id-navaznost") === false;

  const globalMetrics = useMemo(
    () => computeMetrics(kpiRows, "Vybraná data"),
    [kpiRows],
  );

  const perDatasetMetrics = useMemo(() => {
    const map = new Map<string, DatasetMetrics>();
    for (const d of datasets) {
      const rows = kpiRows.filter((r) => r.datasetLabel === d.label);
      map.set(d.label, computeMetrics(rows, d.label));
    }
    return map;
  }, [datasets, kpiRows]);

  const chartData = useMemo(() => {
    return datasets.map((d) => {
      const m = perDatasetMetrics.get(d.label);
      return {
        name: d.label,
        váženáZměna: m?.weightedDeltaPct ?? 0,
        podílDodatků: m?.shareWithAddendaPct ?? 0,
      };
    });
  }, [datasets, perDatasetMetrics]);

  const sortedRows = useMemo(() => {
    const copy = [...mergedRows];
    const { key, dir } = sort;
    copy.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return dir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return dir === "asc" ? sa.localeCompare(sb, "cs") : sb.localeCompare(sa, "cs");
    });
    return copy;
  }, [mergedRows, sort]);

  const displayRows =
    activeTab === "outliers"
      ? sortedRows.filter((r) => (r.deltaPct ?? 0) >= outlierMinPct)
      : sortedRows;

  const pageRows = displayRows.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize));

  const anyHeuristic = mergedRows.some((r) => r.matchMethod !== "id-navaznost");
  const anyNavColumns = datasets.some((d) => d.navColumnKeys.length > 0);

  const duplicateLabel =
    staged &&
    datasets.some(
      (d) =>
        normalizeText(d.label) === normalizeText(stagedLabel.trim() || staged.labelDraft),
    );

  const toggleSort = (key: keyof ContractAggregateRow) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  };

  return (
    <>
      <header>
        <h1>Registr smluv — report pro vedení</h1>
        <p className="muted">
          Sem přetáhněte export z registru smluv (XLSX/CSV). Zobrazí se <strong>náhled analýzy</strong> —
          zkontrolujte název města a klikněte <strong>Uložit do přehledu</strong>. Postupně můžete
          přidávat další města; data zůstávají v tomto prohlížeči (lze zálohovat do JSON).
        </p>
      </header>

      {persistHint && (
        <div className="banner">{persistHint}</div>
      )}

      {anyHeuristic && datasets.length > 0 && (
        <div className="banner">
          Část párování může být <strong>heuristická</strong> — u kritických případů ověřte vazby
          kliknutím na URL záznamu ve veřejném registru.
        </div>
      )}

      {anyNavColumns && !forceHeuristic && datasets.length > 0 && (
        <div className="banner info">
          V některé sadě jsou sloupce s návaznými ID — u ní se používá <strong>deterministické</strong>{" "}
          párování.
        </div>
      )}

      {!anyNavColumns && datasets.length > 0 && (
        <div className="banner info">
          Exporty bez sloupců „ID návazné smlouvy“ se párují přes č. j. a podobnost názvu.
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      {showStrictWarning && (
        <div className="banner">
          Zapnuté KPI pouze pro deterministické párování, ale v aktuálním výběru žádný takový řádek
          není — KPI jsou prázdné / nulové.
        </div>
      )}

      <section>
        <h2>1. Nahrát export (drag &amp; drop)</h2>
        <div
          className="dropzone"
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="visually-hidden"
            onChange={(e) => onFilesSelected(e.target.files)}
          />
          <strong>Přetáhněte sem soubor</strong>
          <span className="muted"> nebo klikněte a vyberte jeden export (.xlsx / .csv)</span>
        </div>
      </section>

      {staged && stagedMetrics && previewForStaged && (
        <section className="preview-panel">
          <h2>2. Náhled analýzy (ještě neuloženo)</h2>
          <p className="muted">
            Soubor: <code>{staged.fileName}</code>
          </p>
          <label className="block-label">
            Název města / sady (v reportu)
            <input
              type="text"
              value={stagedLabel}
              onChange={(e) => setStagedLabel(e.target.value)}
              placeholder={staged.labelDraft}
            />
          </label>
          {duplicateLabel && (
            <p className="muted warn-text">
              Pozor: stejný název už v přehledu máte — můžete přesto uložit (rozlišíte podle data
              nahrání) nebo název upravte.
            </p>
          )}

          <h3 className="preview-h3">Klíčové ukazatele tohoto exportu</h3>
          <div className="grid-kpi">
            <div className="card-kpi">
              <div className="lab">Počet SOD (po filtrech níže)</div>
              <div className="val">{stagedMetrics.count}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Vážená změna ceny</div>
              <div className="val">{formatPct(stagedMetrics.weightedDeltaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Podíl s dodatkem</div>
              <div className="val">{formatPct(stagedMetrics.shareWithAddendaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Medián změny %</div>
              <div className="val">{formatPct(stagedMetrics.medianDeltaPct)}</div>
            </div>
          </div>

          <div className="preview-actions">
            <button type="button" className="btn" onClick={saveStagedToCollection}>
              Uložit do přehledu a reportu
            </button>
            <button type="button" className="btn secondary" onClick={discardStaged}>
              Zahodit náhled
            </button>
          </div>
        </section>
      )}

      <section>
        <h2>Uložená města ({datasets.length})</h2>
        <p className="muted">
          Tato data jsou automaticky ukládána v prohlížeči na tomto počítači. Zálohu si stáhněte jako
          JSON, pokud přejdete na jiný PC nebo vyčistíte úložiště.
        </p>
        <div className="upload-row">
          {datasets.map((d) => (
            <span key={d.id} className="dataset-chip">
              {d.label} ({d.aggregates.length} SOD)
              <button
                type="button"
                className="btn danger"
                style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
                onClick={() => removeDataset(d.id)}
                title="Odebrat z přehledu"
              >
                ×
              </button>
            </span>
          ))}
          {datasets.length === 0 && <span className="muted">Zatím nic uloženo — nahrajte první export.</span>}
        </div>
        <div className="backup-row">
          <button type="button" className="btn secondary" onClick={exportBackup}>
            Exportovat JSON (záloha)
          </button>
          <button type="button" className="btn secondary" onClick={() => importInputRef.current?.click()}>
            Importovat JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(e) => void onImportFile(e.target.files)}
          />
          {datasets.length > 0 && (
            <button type="button" className="btn danger" onClick={clearAll}>
              Smazat všechna data v prohlížeči
            </button>
          )}
        </div>
      </section>

      <section className="toolbar">
        <label>
          Min. původní cena bez DPH
          <input
            type="number"
            min={0}
            step={1000}
            value={minBasePrice}
            onChange={(e) => setMinBasePrice(Number(e.target.value) || 0)}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={forceHeuristic}
            onChange={(e) => setForceHeuristic(e.target.checked)}
          />
          Vynutit heuristiku
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={strictKpiOnly}
            onChange={(e) => setStrictKpiOnly(e.target.checked)}
          />
          KPI jen z id-navaznost
        </label>
      </section>
      <p className="muted" style={{ marginTop: "-0.5rem" }}>
        Změna ceny / heuristiky přepočítá všechna uložená města. Náhled před uložením reaguje stejně.
      </p>

      {datasets.length > 0 && (
        <section>
          <h2>Report pro vedení (všechna uložená města)</h2>
          <div className="grid-kpi">
            <div className="card-kpi">
              <div className="lab">Počet SOD</div>
              <div className="val">{globalMetrics.count}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">S dodatkem</div>
              <div className="val">{globalMetrics.withAddenda}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Podíl s dodatkem</div>
              <div className="val">{formatPct(globalMetrics.shareWithAddendaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Vážená změna ceny</div>
              <div className="val">{formatPct(globalMetrics.weightedDeltaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Medián změny %</div>
              <div className="val">{formatPct(globalMetrics.medianDeltaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Průměr změny % (vše)</div>
              <div className="val">{formatPct(globalMetrics.avgDeltaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Průměr změny % (jen dodatkované)</div>
              <div className="val">{formatPct(globalMetrics.addendaOnlyAvgDeltaPct)}</div>
            </div>
            <div className="card-kpi">
              <div className="lab">Průměr počtu dodatků (u dodatkovaných)</div>
              <div className="val">
                {globalMetrics.addendaOnlyAvgCount !== null
                  ? globalMetrics.addendaOnlyAvgCount.toFixed(2)
                  : "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {datasets.length > 1 && (
        <section>
          <h2>Srovnání měst</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(v) => formatPct(typeof v === "number" ? v : Number(v))}
                />
                <Legend />
                <Bar dataKey="váženáZměna" name="Vážená změna %" fill="#1d4ed8" />
                <Bar dataKey="podílDodatků" name="Podíl s dodatkem %" fill="#0d9488" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {datasets.length > 0 && (
        <>
          <section className="toolbar">
            <label>
              Rok (km. smlouvy)
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">Všechny</option>
                {[2025, 2024, 2023, 2022, 2021, 2020].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hledat
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              Outlier od (%)
              <input
                type="number"
                min={0}
                value={outlierMinPct}
                onChange={(e) => setOutlierMinPct(Number(e.target.value) || 0)}
              />
            </label>
          </section>

          <div className="tabs">
            <button
              type="button"
              className={activeTab === "all" ? "active" : ""}
              onClick={() => {
                setActiveTab("all");
                setPage(0);
              }}
            >
              Všechny smlouvy ({mergedRows.length})
            </button>
            <button
              type="button"
              className={activeTab === "outliers" ? "active" : ""}
              onClick={() => {
                setActiveTab("outliers");
                setPage(0);
              }}
            >
              Outliers ≥ {outlierMinPct}%
            </button>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("datasetLabel")}>Město (sada)</th>
                  <th onClick={() => toggleSort("city")}>Město v datech</th>
                  <th onClick={() => toggleSort("supplier")}>Dodavatel</th>
                  <th onClick={() => toggleSort("subject")}>Název</th>
                  <th onClick={() => toggleSort("basePrice")}>Původní</th>
                  <th onClick={() => toggleSort("addendaCount")}>Dodatků</th>
                  <th onClick={() => toggleSort("addendaSum")}>Součet dod.</th>
                  <th onClick={() => toggleSort("finalPrice")}>Po dod.</th>
                  <th onClick={() => toggleSort("deltaPct")}>Změna %</th>
                  <th>Metoda</th>
                  <th>Odkazy</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const dp = r.deltaPct ?? 0;
                  const heat =
                    r.deltaPct === null
                      ? ""
                      : dp >= outlierMinPct
                        ? "heat-high"
                        : dp >= 15
                          ? "heat-mid"
                          : "";
                  return (
                    <tr key={`${r.contractId}-${r.datasetLabel}-${r.subject.slice(0, 24)}`}>
                      <td>{r.datasetLabel}</td>
                      <td>{r.city}</td>
                      <td>{r.supplier}</td>
                      <td>{r.subject}</td>
                      <td>{formatMoney(r.basePrice)}</td>
                      <td>{r.addendaCount}</td>
                      <td>{formatMoney(r.addendaSum)}</td>
                      <td>{formatMoney(r.finalPrice)}</td>
                      <td className={heat}>{formatPct(r.deltaPct)}</td>
                      <td>{methodLabel(r.matchMethod)}</td>
                      <td>
                        {r.url && (
                          <a className="link" href={r.url} target="_blank" rel="noreferrer">
                            kmen
                          </a>
                        )}
                        {r.addendumUrls.map((u) => (
                          <div key={u}>
                            <a className="link" href={u} target="_blank" rel="noreferrer">
                              dodatek
                            </a>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="upload-row" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn secondary"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ← Předchozí
            </button>
            <span className="muted">
              Stránka {page + 1} / {totalPages} (řádků: {displayRows.length})
            </span>
            <button
              type="button"
              className="btn secondary"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Další →
            </button>
          </div>
        </>
      )}
    </>
  );
}
