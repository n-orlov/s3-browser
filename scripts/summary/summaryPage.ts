// Pure rendering of the CI summary page (no I/O): one self-contained HTML document with the unit and e2e
// counts, the coverage totals against their thresholds, the CRAP offenders and the flaky-test count. It reuses the
// pure helpers of jobSummary.ts (the report types, `COVERAGE_KEYS`, `e2eHasFailure`, `mark`, `pct`), so the page
// and the GitHub job summaries judge the same numbers the same way. `summary.ts html` reads the report files,
// calls `renderSummaryPage` and writes the result; the Jenkinsfile publishes it with publishHTML.
import { COVERAGE_KEYS, e2eHasFailure, mark, pct, type E2eInput, type QualityInput } from './jobSummary.ts';

export interface SummaryPageInput {
  quality: QualityInput;
  e2e: E2eInput[];
  /** Tests that failed in one run and passed in another; `null` when no flaky-count file was produced. */
  flaky: number | null;
}

const NO_DATA = 'no data: the report file was not produced';

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const section = (title: string, body: string[]): string[] => [`<h2>${escapeHtml(title)}</h2>`, ...body];
const missing = (): string => `<p class="nodata">${NO_DATA}</p>`;
const line = (ok: boolean, text: string): string => `<p class="${ok ? 'ok' : 'bad'}">${mark(ok)} ${escapeHtml(text)}</p>`;

function unitSection(unit: QualityInput['unit']): string[] {
  if (!unit) return section('Unit tests', [missing()]);
  const { total, failed, skipped } = unit;
  return section('Unit tests', [line(failed === 0, `${total} tests: ${total - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)]);
}

function coverageSection(input: QualityInput): string[] {
  if (!input.coverage) return section('Coverage', [missing()]);
  const rows = COVERAGE_KEYS.map((key) => {
    const value = input.coverage!.pct[key];
    const threshold = input.thresholds[key];
    const ok = value >= threshold;
    const verdict = ok ? `${mark(true)} met` : `${mark(false)} miss (${pct(threshold - value)} below)`;
    return `<tr class="${ok ? 'ok' : 'bad'}"><td>${key}</td><td>${pct(value)}</td><td>${threshold}%</td><td>${verdict}</td></tr>`;
  });
  return section('Coverage', [
    '<table>',
    '<tr><th>Metric</th><th>Coverage</th><th>Threshold</th><th></th></tr>',
    ...rows,
    '</table>',
  ]);
}

function crapSection(crap: QualityInput['crap']): string[] {
  if (!crap) return section('CRAP', [missing()]);
  const { over, max, functions } = crap;
  return section('CRAP', [line(over === 0, `${over} function${over === 1 ? '' : 's'} over CRAP_MAX (${max}) of ${functions} scored`)]);
}

function e2eSection(shards: E2eInput[]): string[] {
  if (shards.length === 0) return section('End-to-end tests', [missing()]);
  const rows = shards.map(({ shard, counts }) => {
    if (!counts) return `<tr><td>shard ${escapeHtml(shard)}</td><td colspan="2" class="nodata">${NO_DATA}</td></tr>`;
    const ok = !e2eHasFailure(counts);
    const errors = counts.errors > 0 ? `, ${counts.errors} report error${counts.errors === 1 ? '' : 's'}` : '';
    const text = `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped${errors}`;
    return `<tr class="${ok ? 'ok' : 'bad'}"><td>shard ${escapeHtml(shard)}</td><td>${mark(ok)}</td><td>${escapeHtml(text)}</td></tr>`;
  });
  return section('End-to-end tests', ['<table>', ...rows, '</table>']);
}

function flakySection(flaky: number | null): string[] {
  if (flaky === null) return section('Flaky tests', ['<p class="nodata">not measured: no flaky-count file was produced</p>']);
  return section('Flaky tests', [line(flaky === 0, `${flaky} flaky test${flaky === 1 ? '' : 's'}`)]);
}

const STYLE =
  'body{font-family:sans-serif;margin:2em;max-width:60em}table{border-collapse:collapse}' +
  'td,th{border:1px solid #ccc;padding:.3em .8em;text-align:left}.ok{color:#1a7f37}.bad{color:#cf222e}.nodata{color:#6e7781}';

export function renderSummaryPage(input: SummaryPageInput): string {
  const body = [
    ...unitSection(input.quality.unit),
    ...e2eSection(input.e2e),
    ...coverageSection(input.quality),
    ...crapSection(input.quality.crap),
    ...flakySection(input.flaky),
  ];
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>CI summary</title>',
    `<style>${STYLE}</style></head>`,
    '<body>',
    '<h1>CI summary</h1>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** The count in a flaky-count file (`3\n`); `null` for anything that is not a whole number. */
export function parseFlakyCount(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}
