import type { Deal, PipelineStage } from "@/types";
import { downloadBlob } from "@/lib/download-file";
import type { PeriodRange } from "@/lib/period";

// ============================================================
// Pipeline report export — CSV (deal-by-deal detail) and a
// print-ready PDF report (aggregate summary + stage breakdown).
//
// Deliberately zero new dependencies: CSV is plain text (opens
// natively in Excel/Sheets), and the PDF path opens a standalone
// window with its own minimal styles and calls the browser's native
// print → "Save as PDF", the same way this app avoided pulling in a
// calendar or date-picker library elsewhere this session.
//
// Both take already-translated strings/labels from the caller
// (pipeline-analytics.tsx, which has `useTranslations`) rather than
// importing next-intl here — this module has no component context
// (the PDF path in particular runs its content in a brand-new
// `window.open` document), so translation stays the UI layer's job.
// ============================================================

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // Quote whenever the field could otherwise be misread: contains the
  // delimiter, a quote (which must also be doubled), or a line break.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export interface CsvLabels {
  title: string;
  contact: string;
  value: string;
  currency: string;
  stage: string;
  status: string;
  assignee: string;
  createdAt: string;
  closedAt: string;
  statusOpen: string;
  statusWon: string;
  statusLost: string;
}

/**
 * Deals "relevant to" a range means created OR closed inside it — a
 * deal opened in-range but still open (no closed_at yet) belongs in
 * the export just as much as one that closed in-range; excluding it
 * would make an in-progress month look emptier than it is.
 */
function dealsInRange(deals: Deal[], range: PeriodRange): Deal[] {
  return deals.filter((d) => {
    const created = new Date(d.created_at);
    const inByCreation = created >= range.start && created < range.end;
    if (inByCreation) return true;
    if (!d.closed_at) return false;
    const closed = new Date(d.closed_at);
    return closed >= range.start && closed < range.end;
  });
}

export function downloadDealsCsv(
  deals: Deal[],
  stages: PipelineStage[],
  range: PeriodRange,
  pipelineName: string,
  labels: CsvLabels,
): void {
  const stageById = new Map(stages.map((s) => [s.id, s.name]));
  const statusLabel = (status: Deal["status"]) =>
    status === "won" ? labels.statusWon : status === "lost" ? labels.statusLost : labels.statusOpen;

  const rows = dealsInRange(deals, range).map((d) => [
    d.title,
    d.contact?.name || d.contact?.phone || "",
    d.value,
    d.currency ?? "",
    stageById.get(d.stage_id) ?? "",
    statusLabel(d.status),
    d.assignee?.full_name || d.assignee?.email || "",
    isoDate(d.created_at),
    isoDate(d.closed_at),
  ]);

  const header = [
    labels.title,
    labels.contact,
    labels.value,
    labels.currency,
    labels.stage,
    labels.status,
    labels.assignee,
    labels.createdAt,
    labels.closedAt,
  ];

  // Leading BOM so Excel (which guesses encoding from the first
  // bytes, not from a Content-Type it never sees on a local file)
  // reads accented/non-Latin characters correctly instead of mangling them.
  const csv = "﻿" + [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const filename = `${slugify(pipelineName)}-${slugify(range.label)}.csv`;
  downloadBlob(blob, filename);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // Strip combining diacritical marks (the accents NFD split out of
    // letters like á/é/ñ) — U+0300 to U+036F.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface ReportMetric {
  label: string;
  value: string;
}

export interface ReportStageRow {
  name: string;
  color: string;
  count: number;
  value: string;
}

export interface PrintableReport {
  pipelineName: string;
  rangeLabel: string;
  generatedOnLabel: string;
  reportTitle: string;
  stageBreakdownTitle: string;
  stageColumnStage: string;
  stageColumnDeals: string;
  stageColumnValue: string;
  metrics: ReportMetric[];
  stageBreakdown: ReportStageRow[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Opens a blank, app-chrome-free window with a self-contained report
 * document and triggers the browser's print dialog on it — the
 * user's "Save as PDF" destination produces the actual file. Opening
 * a real window (not printing the current page with @media print)
 * means the sidebar/header never has to be fought with print CSS.
 */
export function openPrintableReport(report: PrintableReport): boolean {
  const win = window.open("", "_blank");
  if (!win) return false; // popup blocked — caller can toast

  const metricsHtml = report.metrics
    .map(
      (m) => `<div class="metric"><div class="metric-label">${escapeHtml(m.label)}</div><div class="metric-value">${escapeHtml(m.value)}</div></div>`,
    )
    .join("");

  const stageRowsHtml = report.stageBreakdown
    .map(
      (s) => `<tr>
        <td><span class="dot" style="background:${escapeHtml(s.color)}"></span>${escapeHtml(s.name)}</td>
        <td class="num">${s.count}</td>
        <td class="num">${escapeHtml(s.value)}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(report.reportTitle)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a19; margin: 0; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .subtitle { color: #6b6b68; font-size: 13px; margin: 0 0 24px; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .metric { border: 1px solid #e2e2df; border-radius: 8px; padding: 12px; }
  .metric-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6b68; }
  .metric-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
  h2 { font-size: 14px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eaeae7; }
  th { color: #6b6b68; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  .num { text-align: right; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(report.pipelineName)} — ${escapeHtml(report.reportTitle)}</h1>
  <p class="subtitle">${escapeHtml(report.rangeLabel)} · ${escapeHtml(report.generatedOnLabel)}</p>
  <div class="metrics">${metricsHtml}</div>
  <h2>${escapeHtml(report.stageBreakdownTitle)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(report.stageColumnStage)}</th><th class="num">${escapeHtml(report.stageColumnDeals)}</th><th class="num">${escapeHtml(report.stageColumnValue)}</th></tr></thead>
    <tbody>${stageRowsHtml}</tbody>
  </table>
</body>
</html>`);
  win.document.close();

  // Give the new document a beat to paint before invoking print —
  // calling it synchronously on some browsers opens the dialog over
  // a still-blank page. `onload` is unreliable on a document produced
  // via document.write across browsers, so a short fixed delay is the
  // more consistent choice here.
  setTimeout(() => win.print(), 300);
  return true;
}

export { dealsInRange };
