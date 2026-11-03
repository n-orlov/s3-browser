// SPEC sections 4 and 5 describe the Jenkins topology as it is: no passage may claim that a GitHub workflow is
// retained (still present, kept, "stays until ...") when that workflow is not in the tree. The retired workflows'
// names are assembled from parts so that this file does not itself contain the file names it forbids.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const RETIRED = ["ci", "e2e-soak", "mutation", "release"];
const retiredFile = (stem: string): string => [stem, "yml"].join(".");

/** Sections 4 and 5 of the spec: from the `## 4.` heading up to the end of section 5. */
function sectionsFourAndFive(spec: string): string {
  const start = spec.search(/^## 4\. /m);
  if (start < 0) return "";
  const rest = spec.slice(start + 1);
  const afterFive = rest.search(/^## (?!4\.|5\.)/m);
  return afterFive < 0 ? spec.slice(start) : spec.slice(start, start + 1 + afterFive);
}

const sentencesOfLine = (line: string): string[] =>
  line.split(/(?<=[.;:])\s+(?=[A-Z`*])/).map((s) => s.trim()).filter(Boolean);
/**
 * Each sentence of `text` with the sentences next to it in its paragraph. A paragraph ends at a blank line, a list
 * item, a heading or a table row; a soft line break inside it does not end it.
 */
const sentencesOf = (text: string): { sentence: string; neighbours: string[] }[] =>
  text.split(/\n\s*\n|\n(?=\s*(?:[-*+]|\d+\.)\s|\s*#|\s*\|)/).flatMap((paragraph) => {
    const all = paragraph.split("\n").flatMap(sentencesOfLine);
    return all.map((sentence, i) => ({ sentence, neighbours: [all[i - 1], all[i + 1]].filter((n): n is string => n !== undefined) }));
  });

// A sentence that says a workflow is still around ("still" alone is too common: "the README still links ...").
// Used only for the unnamed case ("the GitHub Actions workflow remains ..."): a NAMED workflow is checked whatever
// verb the sentence uses (retainedWorkflowClaims).
const RETENTION = /\b(stays?|remains?|retain(s|ed)?|preserved?|kept|keeps?|continues?|still (exists?|runs?|present|in place|there|used|scheduled|active)|until (the |all )?(\w+ )?workflows? (are|is) (retired|deleted|removed))\b/i;

// A mention of a workflow the tree does not have is excused only when the clause that holds it IS a departure or
// replacement statement about it. Open English can always put a departure word next to a name without saying the
// workflow left ("checks migrated from it ... without replacing it", "the still-running ... was replaced", "Jenkins has
// not taken over from it"), so the rule is closed, not open: the clause must match one of the anchored statement
// shapes below from a clause boundary to a clause boundary, every slot in them takes only a closed vocabulary, and a
// mention that no shape covers counts as a claim that the workflow is there. The shapes:
// - removed:     "<W> was / were / has since been deleted | retired | removed | dropped | replaced | superseded
//                 [by <Jenkins ...>] [from the repository] [in R5 | when Jenkins took over]", "<W> is gone",
//                 "<W> no longer exists", "<W>, removed in R5, is now a Jenkins stage";
// - replaced:    "<Jenkins ...> replaces | has replaced | supersedes | has taken over from | took over from |
//                 runs instead of <W>";
// - work moved:  "<work> [was] moved | migrated | ported | transferred from | out of <W> [and] to | into <Jenkins ...>",
//                "the <work> of <W> were ported to <Jenkins ...>", "<W> was migrated to <Jenkins ...>",
//                "<work> previously ran in <W> [and now runs in <Jenkins ...>]".
// <W> is the mention (a list of mentions, "the retired GitHub `X` workflow", "the `x.yml` file"); <work> is a work
// noun (testing, checks, jobs, stages ...) with at most two work modifiers, so a data noun ("reports", "records") or
// a clause with its own verb ("Jenkins consumes checks migrated from ...") is no <work>; <Jenkins ...> is Jenkins or
// the Jenkinsfile with at most two modifiers before and three pipeline nouns after it.
// Even a matching shape excuses nothing when the sentence says otherwise: a question; a negation, modality, partial
// or persistence word inside the shape ("not", "will", "partly", "still-running"); or another clause of the sentence
// with such a word or a recurrence ("every Monday") unless that clause is about Jenkins or a workflow the tree has
// and does not refer back to the mention ("it", "its schedule", "that workflow", "which"); or another clause that
// refers back and is not itself one of the shapes, whatever its subject ("Jenkins runs it on version tags" says the
// workflow runs; "it was deleted in R5" is a departure); or a back-reference with
// such a word in a clause of a neighbouring sentence of the paragraph that refers back or speaks of GitHub workflows
// ("It still runs weekly.", "GitHub still runs a copy."); or a
// fragment after the statement with no subject of its own ("... and back", "..., in theory").
const W = "⟦W⟧";
const W_LIST = String.raw`${W}(?:\s*,\s*${W})*(?:,?\s+and\s+${W})?`;
const NP_W = String.raw`(?:the\s+)?(?:(?:retired|former|old|deleted|original|two|three|four)\s+)*(?:GitHub\s+)?(?:Actions\s+)?(?:(?:workflow\s+)?(?:files|workflows)\s*\(\s*${W_LIST}\s*\)|${W_LIST}(?:\s+(?:GitHub\s+)?(?:Actions\s+)?(?:workflow|file)s?)?)`;
const BACKTICKED = "`[\\w./-]+`";
const JENKINS_WORD = String.raw`(?:release|nightly|weekly|soak|e2e|mutation|stability|trivy|quality|gate|pull-request|master|ci|job|jobs|lane|lanes|stage|stages|pipeline|pipelines|step|steps|build|builds|summary|page|${BACKTICKED})`;
const JENKINS_NP = String.raw`(?:(?:the|a|an)\s+)?(?:${JENKINS_WORD}\s+){0,2}\`?Jenkins(?:file(?:\.[\w-]+)?)?\`?(?:\s+${JENKINS_WORD}){0,3}`;
const WORK_WORD = String.raw`(?:mutation|soak|e2e|lint|unit|release|nightly|weekly|quality|coverage|trivy|stability|smoke|pull-request|macos|windows|linux|${BACKTICKED})`;
const WORK_HEAD = String.raw`(?:testing|tests|checks|suite|jobs?|stages?|steps?|gates?|scans?|builds?|work|publishing|linting|packaging)`;
const WORK_NP = String.raw`(?:(?:the|all|its)\s+)?(?:${WORK_WORD}\s+){0,2}${WORK_HEAD}`;
const AUX_PAST = String.raw`(?:was|were|(?:has|have|had)\s+(?:since\s+|now\s+|already\s+|all\s+)?been)`;
const ADVS = String.raw`(?:(?:now|since|fully|all|both|also|already|previously|formerly)\s+)*`;
const MOVE = String.raw`(?:moved|migrated|ported|transferred)`;
const REMOVED = String.raw`(?:deleted|retired|removed|dropped|replaced|superseded)`;
const SHAPES = [
  String.raw`${NP_W},?\s+${AUX_PAST}\s+${ADVS}${REMOVED}(?:\s+(?:by|with)\s+${JENKINS_NP})?(?:\s+from\s+the\s+(?:repository|repo|tree))?(?:\s+(?:in\s+R\d+(?:\.\d+)?|when\s+Jenkins\s+took\s+over))?`,
  String.raw`${NP_W}\s+(?:(?:is|are)\s+(?:now\s+)?gone|no\s+longer\s+exists?)`,
  String.raw`${NP_W},\s+${REMOVED}(?:\s+in\s+R\d+(?:\.\d+)?)?,\s+(?:is|was)\s+(?:now\s+)?${JENKINS_NP}`,
  String.raw`${JENKINS_NP}\s+(?:now\s+)?(?:replaces|replaced|has\s+replaced|supersedes|superseded|has\s+superseded|has\s+taken\s+over\s+from|took\s+over\s+from|takes\s+over\s+from|runs\s+instead\s+of|ran\s+instead\s+of)\s+${NP_W}`,
  String.raw`${WORK_NP}\s+(?:${AUX_PAST}\s+)?${ADVS}${MOVE}\s+(?:from|out\s+of)\s+${NP_W},?\s+(?:and\s+)?(?:in)?to\s+${JENKINS_NP}`,
  String.raw`the\s+${WORK_HEAD}\s+of\s+${NP_W}\s+${AUX_PAST}\s+${ADVS}${MOVE}\s+(?:in)?to\s+${JENKINS_NP}`,
  String.raw`${NP_W}\s+${AUX_PAST}\s+${ADVS}${MOVE}\s+(?:in)?to\s+${JENKINS_NP}`,
  String.raw`${WORK_NP}\s+(?:previously|formerly)\s+ran\s+in\s+${NP_W}(?:\s+and\s+now\s+runs\s+in\s+${JENKINS_NP})?`,
].map((shape) => new RegExp(String.raw`(?:${shape})(?=\s*$|\s*;|,\s|\s+(?:and|but)\s+)`, "iy"));
// Where a shape may begin: the start of the sentence, or after a semicolon or a coordinating "and" / "but".
const CLAUSE_START = /;\s*|,?\s+(?:and|but)\s+/g;
// Where the rest of the sentence splits into clauses.
const CLAUSE_SPLIT = /;|,\s+|\s+(?:and|but|while|whereas|although|though|because|since|so)\s+/i;
// Words that say the statement is not (yet, wholly, really) a departure, or that the workflow is still there.
const NEGATES = /\b(?:not|never|without|nor|neither|cannot|none|no|yet\s+to|rather\s+than|fail(?:s|ed|ing)?\s+to)\b|n't\b/i;
const HYPOTHETICAL = /\b(?:will|would|shall|should|may|might|could|can|must|going\s+to|plan(?:s|ned)?|intend(?:s|ed)?|propos\w*|to\s+be|until|unless|if|whether|pending|soon|eventually|supposed|meant|expected|due|partly|partially|in\s+part|mostly|largely|half)\b/i;
const PERSISTS = /\b(?:still|remains?|remaining|stays?|continu\w*|survives?|surviving|retained|kept|keeps|preserved|active|enabled|running|live|existing|current(?:ly)?|ongoing)\b/i;
// A recurrence ("after each run", "every Thursday", "weekly."): the workflow still runs. A frequency word used as an
// adjective ("the Jenkins nightly lane") is not a recurrence.
const RECURS = /\bevery\b|\beach\s+(?:run|build|push|commit|tag|release|merge|night|day|week|month|hour|time|cycle|(?:mon|tues|wednes|thurs|fri|satur|sun)day)s?\b|\bper\s+(?:run|build|push|commit|tag|release|night|day|week)\b|\b(?:hourly|daily|nightly|weekly|monthly)\b(?!\s+[a-z])|\bon\s+(?:mon|tues|wednes|thurs|fri|satur|sun)days\b/i;
const contradicts = (text: string): boolean => NEGATES.test(text) || HYPOTHETICAL.test(text) || PERSISTS.test(text) || RECURS.test(text);
// A reference back to the mentioned workflow.
const REFERS_BACK = /\b(?:it|its|they|them|their|theirs|one|ones|which|whose|whereby)\b|\b(?:this|that|these|those|the|same|said|such)\s+(?:same\s+|said\s+|old\s+|former\s+|retired\s+|original\s+|deleted\s+)?(?:GitHub\s+)?(?:Actions\s+)?(?:workflows?|files?|jobs?|pipelines?|schedules?|crons?|triggers?|runs?)\b/i;
// A back-referring clause that only removes the workflow again ("and the file was deleted").
const REMOVES_AGAIN = /^(?:it|they|the\s+(?:same\s+)?(?:workflow|file)s?|its\s+file)\s+(?:was|were|(?:has|have)\s+been)\s+(?:deleted|retired|removed)(?:\s+from\s+the\s+(?:repository|repo|tree))?$/i;

// How a clause outside the statement must open: with its own subject. A fragment ("and back", "then restored", ", in
// theory") qualifies the statement itself and is not trusted.
const OPENS_WITH_SUBJECT = /^(?:(?:the|a|an|this|that|these|those|its|their|it|they|both|all|each|no)\b|`|[A-Z])/;
// A neighbouring sentence is read when it refers back or speaks of GitHub workflows at all.
// ("GitHub" as the service, not in a host name such as `n-orlov.github.io`, and not GitHub Pages).
const SPEAKS_OF_WORKFLOWS = /\b(?:Actions|[Ww]orkflows?)\b|(?<![\w./-])GitHub(?![\w/-]|\.\w)(?!\s+Pages\b)/;

/**
 * True when a clause outside the departure statement leaves it standing. A clause of the statement's own sentence
 * must open with a subject (`ownSentence`); a clause of another sentence need not.
 */
function clauseAgrees(clause: string, have: Set<string>, ownSentence = true): boolean {
  const c = clause.trim().replace(/^(?:and|but|or)\s+/i, "").replace(/[.!]+$/, "");
  if (!c) return true;
  if (ownSentence && !OPENS_WITH_SUBJECT.test(c)) return false;
  const back = REFERS_BACK.test(c);
  const subject = c.split(/\s+/).slice(0, 5).map((w) => w.replace(/[`'",()]/g, "").toLowerCase());
  const aboutJenkinsOrPresent = subject.some((w) => w.startsWith("jenkins") || have.has(w));
  if (!back) return !contradicts(c) || aboutJenkinsOrPresent;
  // A clause that refers back to the mention says something about the absent workflow, whatever its subject
  // ("Jenkins runs it on version tags" says the workflow runs). It leaves the departure standing only when it is
  // itself a departure statement about the workflow ("it was deleted in R5", "the Jenkins stage replaces it").
  return REMOVES_AGAIN.test(c) || isDeparture(c.replace(new RegExp(REFERS_BACK.source, "gi"), W));
}

/** True when the whole of `clause` (the mention written as W) is one departure or replacement statement (SHAPES). */
function isDeparture(clause: string): boolean {
  return SHAPES.some((shape) => {
    shape.lastIndex = 0;
    const hit = shape.exec(clause);
    return hit !== null && hit[0].trim().length === clause.trim().length && !contradicts(hit[0].replace(/\bno\s+longer\s+exists?\b/i, ""));
  });
}

/**
 * True when `m` lies inside a departure or replacement statement (SHAPES) of `sentence` that nothing else in the
 * sentence, nor a neighbouring sentence of the same paragraph (`neighbours`) that refers back or speaks of GitHub
 * workflows, contradicts.
 */
function saysItLeft(sentence: string, m: Mention, absent: Mention[], have: Set<string>, neighbours: string[]): boolean {
  if (sentence.includes("?")) return false;
  const neighbourClauses = neighbours.flatMap((n) => n.split(CLAUSE_SPLIT));
  if (neighbourClauses.some((c) => (REFERS_BACK.test(c) || SPEAKS_OF_WORKFLOWS.test(c)) && !clauseAgrees(c, have, false))) return false;
  // Each absent mention becomes the token W (with the backticks around a file name); `at` is where m's token starts.
  let norm = "";
  let at = -1;
  let pos = 0;
  for (const a of [...absent].sort((x, y) => x.start - y.start)) {
    let s = a.start;
    let e = a.end;
    if (s < pos) continue;
    if (sentence[s - 1] === "`" && sentence[e] === "`") { s -= 1; e += 1; }
    norm += sentence.slice(pos, s);
    if (a === m) at = norm.length;
    norm += W;
    pos = e;
  }
  norm = (norm + sentence.slice(pos)).replace(/[.!]+\s*$/, "");
  if (at < 0) return false;
  const starts = [0, ...[...norm.matchAll(CLAUSE_START)].map((c) => (c.index ?? 0) + c[0].length)];
  for (const start of starts) {
    for (const shape of SHAPES) {
      shape.lastIndex = start;
      const hit = shape.exec(norm);
      if (!hit || at < start || at >= start + hit[0].length) continue;
      const end = start + hit[0].length;
      if (contradicts(hit[0].replace(/\bno\s+longer\s+exists?\b/i, ""))) continue;
      const rest = [norm.slice(0, start), norm.slice(end)].flatMap((part) => part.split(CLAUSE_SPLIT));
      if (rest.every((clause) => clauseAgrees(clause, have))) return true;
    }
  }
  return false;
}

/** A mention of a workflow (by title or file name) at [start, end) of its sentence. */
interface Mention { name: string; start: number; end: number }

/** Workflow titles a sentence refers to: "GitHub `X` workflow", "the `X` workflow", "GitHub Actions X workflow", "workflow `X`". */
function titleMentions(sentence: string): Mention[] {
  const out: Mention[] = [];
  const add = (m: RegExpMatchArray): void => { out.push({ name: m[1].trim().toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }); };
  for (const m of sentence.matchAll(/`([^`]+)`\s+(?:GitHub\s+)?(?:Actions\s+)?workflow\b/gi)) add(m);
  for (const m of sentence.matchAll(/\b(?:GitHub|Actions)\s+(?!Actions\b|workflows?\b)([A-Za-z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)*)\s+workflow\b/g)) add(m);
  for (const m of sentence.matchAll(/\bworkflow\s+`([^`]+)`/gi)) add(m);
  return out.filter((t) => !/^\.?github\/|\.ya?ml$/.test(t.name));
}

/** `*.yml` / `*.yaml` file names a sentence mentions. */
function fileMentions(sentence: string): Mention[] {
  return [...sentence.matchAll(/[A-Za-z0-9][\w.-]*\.ya?ml\b/g)].map((m) => ({ name: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** The workflow names a tree provides: each file's name and stem, plus its `name:` line. */
function workflowNames(files: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, text] of Object.entries(files)) {
    names.add(file.toLowerCase());
    names.add(file.replace(/\.ya?ml$/, "").toLowerCase());
    const n = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(text)?.[1];
    if (n) names.add(n.toLowerCase());
  }
  return names;
}

/**
 * One problem per claim in `section` that a workflow is retained although it is not in `workflows` (file name ->
 * text of `.github/workflows/`) or, for a `*.yml` named outside that directory, not in `otherFiles`. Any mention of
 * an absent workflow counts as such a claim ("the GitHub `Mutation` workflow is retained / runs weekly / stays ..."),
 * whatever the verb, unless the mention is inside a departure or replacement statement (saysItLeft).
 */
function retainedWorkflowClaims(section: string, workflows: Record<string, string>, otherFiles: Set<string>): string[] {
  const have = workflowNames(workflows);
  const problems: string[] = [];
  for (const { sentence, neighbours } of sentencesOf(section)) {
    const files = fileMentions(sentence);
    const titles = titleMentions(sentence);
    const absentFiles = files.filter((m) => !have.has(m.name) && !otherFiles.has(m.name));
    const absentTitles = titles.filter((m) => !have.has(m.name));
    const absent = [...absentFiles, ...absentTitles];
    for (const m of absentFiles) {
      if (!saysItLeft(sentence, m, absent, have, neighbours)) problems.push(`names ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    for (const m of absentTitles) {
      if (!saysItLeft(sentence, m, absent, have, neighbours)) problems.push(`names workflow ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    // A retained workflow with no name at all cannot be checked against the tree, so it is rejected outright.
    if (RETENTION.test(sentence) && files.length === 0 && titles.length === 0 && /\b(GitHub|Actions)\b[^.`]{0,20}\bworkflows?\b/i.test(sentence)) {
      problems.push(`claims a retained workflow without naming it: ${sentence.slice(0, 80)}`);
    }
  }
  return problems;
}

function treeOtherFiles(): Set<string> {
  const out = new Set<string>();
  for (const dir of [".", ".github"]) for (const e of readdirSync(path.join(root, dir))) out.add(e.toLowerCase());
  return out;
}

function treeWorkflows(): Record<string, string> {
  const dir = path.join(root, ".github/workflows");
  const files: Record<string, string> = {};
  for (const f of existsSync(dir) ? readdirSync(dir) : []) files[f] = readFileSync(path.join(dir, f), "utf8");
  return files;
}

const WORKFLOWS = { "codeql.yml": "name: CodeQL\n", "macos-build.yml": "name: macos-build\n" };
const NONE = new Set<string>();

describe("SPEC sections 4 and 5 against the workflows in the tree", () => {
  it("make no retained-workflow claim the tree contradicts", () => {
    const spec = readFileSync(path.join(root, "SPEC.md"), "utf8");
    const section = sectionsFourAndFive(spec);
    expect(section.length).toBeGreaterThan(1000);
    expect(retainedWorkflowClaims(section, treeWorkflows(), treeOtherFiles())).toEqual([]);
  });

  it("has none of the retired workflow files in the tree", () => {
    for (const stem of RETIRED) expect(existsSync(path.join(root, ".github/workflows", retiredFile(stem))), stem).toBe(false);
  });

  // Red fixtures: the finding's own passage and further cases of the same rule.
  it.each([
    ["the finding's passage: the GitHub Mutation workflow stays until the workflows are retired", "The GitHub `Mutation` workflow below stays until the workflows are retired."],
    ["a retired file named as still running", `\`${retiredFile("release")}\` still runs the nightly soak.`],
    ["a retired file named as a kept gate", `The merge gate is \`${retiredFile("ci")}\`, which is kept for the pull request.`],
    ["a retained workflow that no file provides, without a name", "The GitHub Actions workflow remains in place beside the Jenkinsfile."],
    ["a retained workflow with a different title", "The GitHub `Soak` workflow still exists and repeats the e2e suite."],
    // The review's probe, and further phrasings of the same rule that no fixed list of retention verbs would hold.
    ["the review's probe: is retained", "The GitHub `Mutation` workflow is retained for scheduled mutation testing."],
    ["a retired workflow said to run, with no retention verb", "Mutation testing runs weekly in the GitHub `Mutation` workflow."],
    ["a retired workflow said to be preserved, without the word GitHub", "The `E2E soak` workflow is preserved for the nightly repeat."],
    ["a retired workflow said to continue", "The GitHub Actions Release workflow continues to publish tagged builds."],
    ["a retired workflow by `workflow X`", "Scheduled mutation testing belongs to workflow `Mutation` on GitHub."],
    ["a retained claim beside a deletion statement", "The soak workflow file was deleted, but the GitHub `Mutation` workflow is retained."],
    ["a retired file said to be preserved", `\`${retiredFile("mutation")}\` is preserved for scheduled mutation testing.`],
    // The verifier's probe: a leaving word elsewhere in the sentence ("migrated") is about something else, and further
    // cases of the same rule where a leaving word sits in the sentence but is not attached to the named workflow.
    ["the verifier's probe: a leaving word about other checks", "The GitHub `Mutation` workflow runs every Monday alongside the migrated Jenkins checks."],
    ["a leaving word after the claim, about another stage", `\`${retiredFile("mutation")}\` runs weekly next to the replaced lint stage.`],
    ["a leaving verb before the mention, about other checks", "Nightly checks moved to Jenkins and the GitHub `E2E soak` workflow repeats the suite."],
    ["a leaving adjective on another job", "The retired Trivy job aside, the GitHub `Release` workflow publishes tagged builds."],
    ["a deleted file beside a retained one", `The deleted \`${retiredFile("ci")}\` aside, \`${retiredFile("release")}\` still publishes tags.`],
    // The second review's probe: a source relationship ("from") is not a departure; "still runs" is a retention claim.
    ["the second probe: reports come from the workflow, which still runs", "Mutation reports come from the GitHub `Mutation` workflow, which still runs every Monday."],
    ["a source relationship with a retired file", `The release notes are generated from \`${retiredFile("release")}\` every tag.`],
    ["data fetched from a retired workflow", "Coverage is fetched from the GitHub `E2E soak` workflow artifacts."],
    ["derived from a retired workflow, which stays", "The schedule is derived from the GitHub `Mutation` workflow, which stays in place."],
    ["a departing verb contradicted by a persistence clause", "Mutation testing moved from the GitHub `Mutation` workflow, which still runs every Monday."],
    ["a past-tense aside that does not say the workflow left", "The `Mutation` workflow, previously weekly, now runs nightly."],
    // The third review's probe: taking something from a workflow is a source relationship, not a departure; and
    // further cases of the same rule: extraction verbs, present-passive and recurring transfers, and a replacement
    // in which the named workflow is the replacement, not the one replaced.
    ["the third probe: snapshots taken from the workflow every Tuesday", "The telemetry snapshots are taken from the GitHub `Mutation` workflow every Tuesday."],
    ["taken from a retired file, with no recurrence", `The coverage baseline was taken from \`${retiredFile("mutation")}\`.`],
    ["a job split from a workflow that stays", "The soak job was split from the GitHub `Release` workflow."],
    ["a step removed from a workflow that stays", "The lint step was removed from the GitHub `Mutation` workflow."],
    ["a step dropped from a retired file", `The Trivy step was dropped from \`${retiredFile("ci")}\` last month.`],
    ["a present-passive transfer", `Results are migrated from \`${retiredFile("release")}\` into the dashboard.`],
    ["a departing verb with a recurrence after the mention", "Data were transferred from the GitHub `E2E soak` workflow every night."],
    ["the workflow named as the replacement", "The old cron job was replaced by the GitHub `Mutation` workflow."],
    ["the workflow named as the replacement, with 'with'", `The manual upload was replaced with \`${retiredFile("release")}\`.`],
    ["the workflow as the active replacer", "The GitHub `Release` workflow replaced the manual upload script."],
    ["the workflow as the active superseder", "The `Mutation` workflow superseded the cron job last spring."],
    ["a retired file as the active remover", `\`${retiredFile("ci")}\` removed the old lint step.`],
    // The fourth review's probes: a move with no destination is a source relationship, and a move somewhere other
    // than Jenkins says the workflow still exists; and further cases of the same rule: data provenance, a removal
    // from something other than the repository, a persistence clause after "but it", a move to another runner.
    ["the fourth probe: reports transferred from the workflow after each run", "The nightly dashboard imports reports transferred from the GitHub `Mutation` workflow after each run."],
    ["the fourth probe: migrated to a new runner and still runs", "The GitHub `Mutation` workflow was migrated to a new runner and still runs every Thursday."],
    ["a workflow moved to another runner, with no persistence word", "The GitHub `Release` workflow was moved to a self-hosted macOS runner."],
    ["data provenance into Jenkins", `Coverage reports transferred from \`${retiredFile("mutation")}\` to the Jenkins summary page.`],
    ["history ported from a retired file before every build", `The Allure history was ported from \`${retiredFile("release")}\` before every build.`],
    ["removed from the required checks, not from the tree", "The GitHub `E2E soak` workflow was removed from the required checks."],
    ["deleted, but it still runs", `The \`${retiredFile("mutation")}\` file was deleted, but it still runs from a fork.`],
    ["retired from the gate, runs weekly", "The GitHub `Mutation` workflow was retired from the pull request gate and runs weekly."],
    ["moved to Jenkins, which still runs it each night", "Mutation testing moved from the GitHub `Mutation` workflow to Jenkins, and it still runs each night."],
    // The fifth review's probes: data transfers separated from the verb by an auxiliary or an adverb, and a clause
    // that opens with a reference back to the workflow; and further cases of the same rule.
    ["the fifth probe: records were transferred from the workflow to a dashboard", "The telemetry records were transferred from the GitHub `Mutation` workflow to the Jenkins dashboard."],
    ["the fifth probe: an archive is regularly transferred", "The metrics archive is regularly transferred from the GitHub `Mutation` workflow to Jenkins."],
    ["the fifth probe: migrated, but that workflow still runs", "The GitHub `Mutation` workflow was migrated to Jenkins, but that workflow still runs on GitHub."],
    ["a summary that gets moved from the workflow", `The coverage summary gets moved from \`${retiredFile("release")}\` into Jenkins.`],
    ["history automatically ported from a retired file", `The Allure history is automatically ported from \`${retiredFile("mutation")}\` to Jenkins.`],
    ["a modal passive transfer of statistics", "Statistics will be moved from the GitHub `E2E soak` workflow to the Jenkins summary page."],
    ["a recurrence adverb before the verb", "The nightly numbers were routinely migrated from the GitHub `Mutation` workflow to Jenkins."],
    ["deleted, but its schedule still fires", `The \`${retiredFile("mutation")}\` file was deleted, but its schedule still fires.`],
    ["migrated, but the same workflow remains enabled", "The GitHub `Release` workflow was migrated to Jenkins, but the same workflow remains enabled on GitHub."],
    ["replaced; that file still runs on forks", `\`${retiredFile("ci")}\` was replaced by the Jenkins lane; that file still runs on forks.`],
    // The sixth review's probes: a source relationship inside a clause with its own verb, persistence before the
    // mention and a negated takeover; and further cases of the same rule that a departure word next to the name does
    // not make the clause a departure statement: negation, modality, a partial replacement, a question, persistence
    // in another clause or the next sentence, a reduced relative after another verb, a currency adjective.
    ["the sixth probe: checks migrated from the workflow without replacing it", "Jenkins consumes test checks migrated from the GitHub `Mutation` workflow to Jenkins without replacing the workflow."],
    ["the sixth probe: the still-running workflow was replaced", "The still-running GitHub `Mutation` workflow was replaced by Jenkins."],
    ["the sixth probe: Jenkins has not taken over", "Jenkins has not taken over from the GitHub `Mutation` workflow."],
    ["a contracted negation of a takeover", `Jenkins hasn't replaced \`${retiredFile("release")}\`.`],
    ["a takeover that never happened", "Jenkins never took over from the GitHub `E2E soak` workflow."],
    ["a future replacement", "Jenkins will replace the GitHub `Mutation` workflow."],
    ["a planned removal", `\`${retiredFile("ci")}\` is to be deleted when Jenkins takes over.`],
    ["a removal that is yet to happen", "Mutation testing has yet to move from the GitHub `Mutation` workflow to Jenkins."],
    ["a partial replacement", "The Jenkins release job partly replaces the GitHub `Release` workflow."],
    ["a question", "Was the GitHub `Mutation` workflow replaced by Jenkins?"],
    ["a currency adjective before the mention", "The currently active GitHub `Release` workflow was superseded by the Jenkins release job."],
    ["a reduced relative after another verb, with no negation", `Jenkins runs checks ported from \`${retiredFile("ci")}\` to Jenkins.`],
    ["a takeover with a relative clause that says it still runs", "Jenkins has taken over from the GitHub `Mutation` workflow, which still runs on forks."],
    ["a takeover, but GitHub still runs it", "Jenkins has taken over from the GitHub `Mutation` workflow, but GitHub still runs it weekly."],
    ["a takeover contradicted in the next sentence", "Jenkins has taken over from the GitHub `Mutation` workflow.\nIt still runs every Monday."],
    ["a takeover after a concessive clause", "Although it still runs, Jenkins has taken over from the GitHub `Mutation` workflow."],
    ["a takeover, and GitHub executes it", `Jenkins took over from \`${retiredFile("mutation")}\`, and GitHub executes it from a fork.`],
    ["replaced by a Jenkins job that never ran", "The GitHub `Release` workflow was replaced by the Jenkins release job that never ran."],
    ["a replacement in a conditional", "If the GitHub `Mutation` workflow was replaced by Jenkins, the badge turns grey."],
    ["a move that went back", "Mutation testing moved from the GitHub `Mutation` workflow to Jenkins and back."],
    ["a replacement that was undone", "The GitHub `Mutation` workflow was replaced by Jenkins, then restored."],
    ["a takeover only in theory", "Jenkins has taken over from the GitHub `Mutation` workflow, in theory."],
    ["a takeover beside a sentence that says GitHub runs it too", "Jenkins has taken over from the GitHub `Mutation` workflow; GitHub Actions runs it too."],
    ["a takeover beside a sentence that says GitHub still runs a copy", "Jenkins has taken over from the GitHub `Mutation` workflow. GitHub still runs the old copy weekly."],
    ["a takeover with a parenthetical that says it still runs", "Jenkins has taken over from the GitHub `Mutation` workflow (which still runs)."],
    ["a replacement in name only", "Jenkins replaces the GitHub `Mutation` workflow in name only."],
    ["a replacement after which both still run", "The GitHub `Mutation` workflow was replaced by the Jenkins nightly lane; both still run."],
    ["a replacement GitHub reinstated", "Jenkins replaced the GitHub `Mutation` workflow, and GitHub reinstated it."],
    ["a deletion beside a sentence that says a copy still runs on GitHub", "The GitHub `Mutation` workflow was deleted. A copy still runs on GitHub."],
    ["a replacement beside a sentence that says workflow runs still appear", "The GitHub `Mutation` workflow was deleted from the repository. Workflow runs still appear weekly."],
    ["a counterfactual replacement", "Jenkins would have replaced the GitHub `Mutation` workflow."],
    ["a replacement still in progress", "Jenkins is replacing the GitHub `Mutation` workflow."],
    ["a replacement scoped to pull requests only", "The GitHub `Mutation` workflow was replaced by Jenkins for pull requests only."],
    ["a Jenkins-subject clause that triggers the workflow", "Jenkins took over from the GitHub `Mutation` workflow, and the Jenkins job triggers it every Monday."],
    // The seventh review's probe: a clause about Jenkins that refers back to the absent workflow says the workflow
    // still runs ("Jenkins runs it"); and further cases of the same rule in other verbs, back-references and places.
    ["the seventh probe: Jenkins runs it on version tags", "Jenkins took over from the GitHub `Release` workflow; Jenkins runs it on version tags."],
    ["a Jenkinsfile replacement, then Jenkins dispatches it", "The Jenkinsfile replaced the GitHub `Release` workflow; Jenkins dispatches it for tagged builds."],
    ["a deletion, then a Jenkins stage invokes that workflow", `\`${retiredFile("release")}\` was deleted in R5; the Jenkins release stage invokes that workflow for macOS builds.`],
    ["a takeover, then Jenkins hosts its jobs", "Jenkins has taken over from the GitHub `Mutation` workflow, and Jenkins hosts its jobs."],
    ["a takeover, then the next sentence says a Jenkins lane starts it", "Jenkins took over from the GitHub `Soak` workflow. The Jenkins nightly lane starts it."],
    ["a migration, then the Jenkinsfile calls the same workflow", "The GitHub `Mutation` workflow was migrated to Jenkins; the `Jenkinsfile` calls the same workflow."],
  ])("is rejected: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, NONE)).not.toEqual([]);
  });

  // Green fixtures: claims about workflows that are present, and statements that a workflow was deleted.
  it.each([
    ["an existing workflow is kept", "The `codeql.yml` workflow stays on GitHub-hosted runners."],
    ["an existing workflow by title", "The GitHub `CodeQL` workflow remains a separate analysis."],
    ["a deletion statement naming the retired files", `The four workflow files (\`${retiredFile("ci")}\`, \`${retiredFile("mutation")}\`) were deleted.`],
    ["a non-workflow yml", "Dependabot's `dependabot.yml` stays at weekly."],
    ["a present workflow running, by title", "The `macos-build` workflow is dispatched by the Jenkins release job."],
    ["a retired workflow said to have moved", "Mutation testing moved from the GitHub `Mutation` workflow to the Jenkins nightly lane."],
    ["a retired workflow migrated away from", "Mutation testing was migrated from the GitHub `Mutation` workflow to the Jenkins nightly lane."],
    ["a retired workflow said to be moved out of", `Mutation testing moved out of \`${retiredFile("mutation")}\` and into the Jenkins nightly lane.`],
    ["a retired workflow said to be retired", "The GitHub `Mutation` workflow was retired; the Jenkins `Mutation` stage replaces it."],
    ["a retired workflow said to have run there previously", "Mutation testing previously ran in the GitHub `Mutation` workflow and now runs in the Jenkins nightly lane."],
    ["a list of retired files said to be deleted", `The \`${retiredFile("ci")}\`, \`${retiredFile("e2e-soak")}\` and \`${retiredFile("release")}\` files were deleted when Jenkins took over.`],
    ["a retired workflow replaced by a Jenkins stage", "The Jenkins `Mutation` stage replaces the retired GitHub `Mutation` workflow."],
    // Genuine departures and replacements in the phrasings the tightened rule must still accept.
    ["Jenkins has taken over from the workflow", "Jenkins has taken over from the GitHub `Mutation` workflow."],
    ["a retired workflow replaced by a Jenkins job", "The GitHub `Release` workflow was replaced by the Jenkins release job."],
    ["a retired file superseded by a Jenkins lane", `\`${retiredFile("mutation")}\` was superseded by the Jenkins nightly lane.`],
    ["a retired workflow, removed in R5", "The GitHub `E2E soak` workflow, removed in R5, is now a Jenkins stage."],
    ["a retired file deleted, then the Jenkins replacement", `The \`${retiredFile("release")}\` file was deleted; Jenkins publishes tags.`],
    ["work transferred out of a retired workflow", "Mutation testing was transferred from the GitHub `Mutation` workflow to the Jenkins nightly lane."],
    ["a retired workflow that has since been dropped", "The GitHub `Release` workflow has since been dropped."],
    // Departures with Jenkins as the destination, removals from the repository, and a later clause about something else.
    ["a retired workflow migrated to Jenkins", "The GitHub `Mutation` workflow was migrated to Jenkins."],
    ["moved into a named Jenkins stage", "Mutation testing moved from the GitHub `Mutation` workflow into the Jenkins `Mutation` stage."],
    ["a retired file deleted from the repository", `The \`${retiredFile("release")}\` file was deleted from the repository when Jenkins took over.`],
    ["a deletion, then a clause about another workflow", `The \`${retiredFile("mutation")}\` file was deleted, and the CodeQL workflow still runs weekly.`],
    ["a retired workflow ported to the Jenkinsfile", `The checks of \`${retiredFile("ci")}\` were ported to the \`Jenkinsfile\` and the file was deleted.`],
    // A back-reference continues the clause only when it is about the workflow: a clause about another subject does not.
    ["migrated to Jenkins, then a clause about the Jenkins job", "The GitHub `Mutation` workflow was migrated to Jenkins, and the Jenkins job runs every Monday."],
    ["migrated, then a clause about the CodeQL workflow", "Mutation testing was migrated from the GitHub `Mutation` workflow to Jenkins, but the CodeQL workflow still runs weekly."],
    ["a past move of a non-data subject with an adverb", "Mutation testing was previously moved from the GitHub `Mutation` workflow to Jenkins."],
    // Genuine departures in further shapes the closed rule accepts.
    ["Jenkins took over from a retired file", `Jenkins took over from \`${retiredFile("release")}\`.`],
    ["a retired workflow that is gone", "The GitHub `Mutation` workflow is gone."],
    ["a retired file that no longer exists", `The \`${retiredFile("ci")}\` file no longer exists.`],
    ["a list of retired files deleted in R5", `The four workflow files (\`${retiredFile("ci")}\`, \`${retiredFile("release")}\`, \`${retiredFile("e2e-soak")}\`, \`${retiredFile("mutation")}\`) were deleted in R5.`],
    ["a Jenkins stage that runs instead of the workflow", "The Jenkins `Soak` stage runs instead of the GitHub `E2E soak` workflow."],
    ["a retired file replaced by the release Jenkinsfile", `The \`${retiredFile("release")}\` workflow was replaced by \`Jenkinsfile.release\`.`],
    ["a named Jenkins job replacing a workflow", "The `s3-browser/release` Jenkins job replaces the GitHub `Release` workflow."],
    ["a workflow retired when Jenkins took over", "The GitHub `Release` workflow was retired when Jenkins took over."],
    ["a takeover beside an unrelated sentence of the same paragraph", "Jenkins has taken over from the GitHub `Mutation` workflow. The README shows the Jenkins badges."],
    // A clause that refers back to the workflow is accepted when it is itself a departure statement about it, and a
    // clause about Jenkins that does not refer back is accepted as before.
    ["a replacement, then it was deleted in R5", "The Jenkinsfile replaced the GitHub `Release` workflow; it was deleted in R5."],
    ["a takeover, then that workflow was removed from the repository", "Jenkins took over from the GitHub `Mutation` workflow; that workflow was removed from the repository."],
    ["a takeover, then the next sentence says it was superseded", "Jenkins took over from the GitHub `Soak` workflow. It was superseded by the Jenkins nightly lane."],
    ["a takeover, then a Jenkins clause with no back-reference", "Jenkins took over from the GitHub `Release` workflow; Jenkins runs the release stage on version tags."],
  ])("is accepted: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, new Set(["dependabot.yml"]))).toEqual([]);
  });
});
