/**
 * KPI metriky nad agregovanými řádky (stejná logika jako build_board_report.py).
 */
import type { ContractAggregateRow } from "./pairAndAggregate";

export type DatasetMetrics = {
  label: string;
  count: number;
  withAddenda: number;
  shareWithAddendaPct: number;
  avgDeltaPct: number | null;
  medianDeltaPct: number | null;
  weightedDeltaPct: number;
  addendaOnlyAvgDeltaPct: number | null;
  addendaOnlyAvgCount: number | null;
  totalBase: number;
  totalAddendaSum: number;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeMetrics(rows: ContractAggregateRow[], label: string): DatasetMetrics {
  if (rows.length === 0) {
    return {
      label,
      count: 0,
      withAddenda: 0,
      shareWithAddendaPct: 0,
      avgDeltaPct: null,
      medianDeltaPct: null,
      weightedDeltaPct: 0,
      addendaOnlyAvgDeltaPct: null,
      addendaOnlyAvgCount: null,
      totalBase: 0,
      totalAddendaSum: 0,
    };
  }

  const deltas = rows.map((r) => r.deltaPct).filter((x): x is number => x !== null && !Number.isNaN(x));
  const avgDeltaPct = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  const medianDeltaPct = median(deltas);

  const totalBase = rows.reduce((s, r) => s + r.basePrice, 0);
  const totalAddendaSum = rows.reduce((s, r) => s + r.addendaSum, 0);
  const weightedDeltaPct = totalBase > 0 ? (totalAddendaSum / totalBase) * 100 : 0;

  const withAddenda = rows.filter((r) => r.addendaCount > 0).length;
  const shareWithAddendaPct = (withAddenda / rows.length) * 100;

  const addOnly = rows.filter((r) => r.addendaCount > 0);
  const addDeltas = addOnly.map((r) => r.deltaPct).filter((x): x is number => x !== null);
  const addendaOnlyAvgDeltaPct = addDeltas.length
    ? addDeltas.reduce((a, b) => a + b, 0) / addDeltas.length
    : null;
  const addendaOnlyAvgCount = addOnly.length
    ? addOnly.reduce((s, r) => s + r.addendaCount, 0) / addOnly.length
    : null;

  return {
    label,
    count: rows.length,
    withAddenda,
    shareWithAddendaPct,
    avgDeltaPct,
    medianDeltaPct,
    weightedDeltaPct,
    addendaOnlyAvgDeltaPct,
    addendaOnlyAvgCount,
    totalBase,
    totalAddendaSum,
  };
}

export function formatMoney(v: number): string {
  return `${v.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč`;
}

export function formatPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)} %`;
}
