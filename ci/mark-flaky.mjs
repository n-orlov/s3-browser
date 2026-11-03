#!/usr/bin/env node
// Flaky-test marker. Retries stay at 0 in vitest and Playwright, so a flaky test fails its run. CI therefore runs a
// suite more than once, hands every run's JSON report to this script, and the test that failed in one run but passed in
// another is marked in the JUnit XML instead of failing the build:
//
//   node ci/mark-flaky.mjs --junit <junit.xml> [--junit <junit.xml> ...] --count-file <flaky-count.txt> <report.json> [...]
//
// A test that failed in at least one run and passed in at least one other becomes one passing <testcase>: its
// <failure>/<error> children turn into <rerunFailure> children (one per failed run) and the suite counters drop by the
// failures that were converted. A test that passed everywhere is untouched. A test that failed in every run stays
// failed and is not counted. The number of marked tests is written to --count-file. Every --junit file is rewritten (a
// sharded suite has one JUnit and one report per shard, and the repeats of a test can land in different shards).
//
// Reports: vitest `json` reporter (jest shape, `testResults`) and Playwright `json` reporter (`suites`). A Playwright
// report written with `--repeat-each=N` counts as N runs (the soak's repeats), so the soak needs one report only.
// Exit codes: 0 done, 2 bad usage or unreadable input.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FAILED = new Set(['failed', 'timedOut', 'interrupted']);

/** `{ key: { file, state } }` for one report; state is 'passed' or 'failed' (skipped tests are left out). */
export function readRun(report, cwd = process.cwd()) {
  const out = new Map();
  const put = (file, titles, state) => {
    if (state !== 'passed' && state !== 'failed') return;
    const key = titles.join(' > ');
    const prev = out.get(`${file}::${key}`);
    // a test that has several results (projects, retries) in one run only passes if every one of them did
    if (prev?.state === 'failed') return;
    out.set(`${file}::${key}`, { file, key, state });
  };
  if (Array.isArray(report.testResults)) {
    for (const suite of report.testResults) {
      const file = path.relative(cwd, suite.name ?? '');
      for (const t of suite.assertionResults ?? []) {
        const titles = [...(t.ancestorTitles ?? []), t.title];
        put(file, titles, FAILED.has(t.status) ? 'failed' : t.status);
      }
    }
  } else if (Array.isArray(report.suites)) {
    const walk = (suite, titles) => {
      const own = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const last = (t.results ?? []).at(-1)?.status;
          put(spec.file ?? suite.file ?? '', [...own, spec.title], FAILED.has(last) ? 'failed' : last);
        }
      }
      for (const child of suite.suites ?? []) walk(child, own);
    };
    for (const suite of report.suites) walk(suite, []);
  } else {
    throw new Error('not a vitest or Playwright JSON report');
  }
  return out;
}

/**
 * The runs inside one report. A vitest report is one run. A Playwright report written with `--repeat-each=N` holds
 * the repeats of a test as N entries of the spec's `tests` list (same project), so entry k belongs to run k and the
 * soak's three repeats of a test count as three runs of it. A report without repeats is one run.
 */
export function readRuns(report, cwd = process.cwd()) {
  if (!Array.isArray(report.suites)) return [readRun(report, cwd)];
  const runs = [];
  const addSpec = (spec, suite, own) => {
    const seenPerProject = new Map();
    for (const t of spec.tests ?? []) {
      const project = t.projectName ?? '';
      const k = seenPerProject.get(project) ?? 0;
      seenPerProject.set(project, k + 1);
      const last = (t.results ?? []).at(-1)?.status;
      const state = FAILED.has(last) ? 'failed' : last;
      if (state !== 'passed' && state !== 'failed') continue;
      while (runs.length <= k) runs.push(new Map());
      const file = spec.file ?? suite.file ?? '';
      const key = [...own, spec.title].join(' > ');
      runs[k].set(`${file}::${key}`, { file, key, state });
    }
  };
  const walk = (suite, titles) => {
    const own = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) addSpec(spec, suite, own);
    for (const child of suite.suites ?? []) walk(child, own);
  };
  for (const suite of report.suites) walk(suite, []);
  return runs.length > 0 ? runs : [new Map()];
}

/** Keys that failed in one run and passed in another, with how many runs failed. */
export function findFlaky(runs) {
  const seen = new Map();
  for (const run of runs) {
    for (const [id, { file, key, state }] of run) {
      const entry = seen.get(id) ?? { file, key, passed: 0, failed: 0 };
      entry[state] += 1;
      seen.set(id, entry);
    }
  }
  return [...seen.values()].filter((e) => e.passed > 0 && e.failed > 0);
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attrOf = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeXml(m[1]) : '';
};

function matches(flaky, attrs) {
  const name = attrOf(attrs, 'name').replace(/ › /g, ' > ');
  if (name !== flaky.key && !name.endsWith(` > ${flaky.key}`)) return false;
  if (!flaky.file) return true;
  return `${attrOf(attrs, 'classname')} ${name}`.includes(path.basename(flaky.file));
}

/** Rewrites one testcase; returns the new text and the failure/error counts that were converted. */
function rewriteCase(attrs, inner, flaky) {
  let failures = 0;
  let errors = 0;
  let marks = '';
  const rest = (inner ?? '').replace(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g, (_m, tag, a, _t, body) => {
    if (tag === 'failure') failures += 1;
    else errors += 1;
    marks += `<rerunFailure${a}>${body ?? ''}</rerunFailure>`;
    return '';
  });
  for (let i = failures + errors; i < flaky.failed; i += 1) {
    marks += '<rerunFailure message="failed in an earlier run" type="Error"></rerunFailure>';
  }
  return { text: `<testcase${attrs}>${rest}${marks}</testcase>`, failures, errors };
}

/** The JUnit text with every flaky test marked; `marked` is how many testcases were rewritten. */
export function markJunit(xml, flakyList) {
  let marked = 0;
  let dFail = 0;
  let dErr = 0;
  const bump = (open, name, delta) =>
    delta === 0
      ? open
      : open.replace(new RegExp(`\\b${name}="(\\d+)"`), (_m, n) => `${name}="${Math.max(0, Number(n) - delta)}"`);
  const out = xml.replace(/<testsuite\b[^>]*>[\s\S]*?<\/testsuite>/g, (block) => {
    let sf = 0;
    let se = 0;
    const body = block.replace(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g, (whole, attrs, inner) => {
      const flaky = flakyList.find((f) => matches(f, attrs));
      if (!flaky) return whole;
      const r = rewriteCase(attrs, inner, flaky);
      marked += 1;
      sf += r.failures;
      se += r.errors;
      return r.text;
    });
    dFail += sf;
    dErr += se;
    return body.replace(/<testsuite\b[^>]*>/, (open) => bump(bump(open, 'failures', sf), 'errors', se));
  });
  const fixed = out.replace(/<testsuites\b[^>]*>/, (open) => bump(bump(open, 'failures', dFail), 'errors', dErr));
  return { xml: fixed, marked };
}

function parseArgs(argv) {
  const args = { reports: [], junits: [], countFile: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--junit') args.junits.push(argv[++i] ?? '');
    else if (argv[i] === '--count-file') args.countFile = argv[++i] ?? '';
    else args.reports.push(argv[i]);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.junits.length === 0 || args.junits.includes('') || !args.countFile || args.reports.length < 1) {
    console.error('usage: mark-flaky.mjs --junit <junit.xml> [--junit <junit.xml> ...] --count-file <file> <report.json> <report.json> [...]');
    return 2;
  }
  let runs;
  let xmls;
  try {
    runs = args.reports.flatMap((p) => readRuns(JSON.parse(readFileSync(p, 'utf8'))));
    xmls = args.junits.map((p) => readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`mark-flaky: ${e.message}`);
    return 2;
  }
  if (runs.length < 2) {
    console.error('mark-flaky: need at least two runs (two reports, or one Playwright report written with --repeat-each)');
    return 2;
  }
  const flaky = findFlaky(runs);
  args.junits.forEach((file, i) => writeFileSync(file, markJunit(xmls[i], flaky).xml));
  writeFileSync(args.countFile, `${flaky.length}\n`);
  for (const f of flaky) console.log(`FLAKY ${f.file}: ${f.key} (failed ${f.failed}, passed ${f.passed})`);
  console.log(`${flaky.length} flaky test(s)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = main(process.argv.slice(2));
}
