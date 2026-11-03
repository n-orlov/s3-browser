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

const sentencesOf = (text: string): string[] =>
  text.split(/\n|(?<=[.;:])\s+(?=[A-Z`*])/).map((s) => s.trim()).filter(Boolean);

// A sentence that says a workflow is still around ("still" alone is too common: "the README still links ...").
// Used only for the unnamed case ("the GitHub Actions workflow remains ..."): a NAMED workflow is checked whatever
// verb the sentence uses (retainedWorkflowClaims).
const RETENTION = /\b(stays?|remains?|retain(s|ed)?|preserved?|kept|keeps?|continues?|still (exists?|runs?|present|in place|there|used|scheduled|active)|until (the |all )?(\w+ )?workflows? (are|is) (retired|deleted|removed))\b/i;

// A mention of a workflow the tree does not have is excused only by a departure or replacement statement about THAT
// mention, and only when nothing in the mention's own clause says the workflow is still there or still runs.
//
// What counts as a departure or replacement:
// - a removal word directly before the mention ("the retired `X` workflow", "previously ran in the `X` workflow",
//   "Jenkins replaces / has taken over from / runs instead of the `X` workflow");
// - a removal predicate directly after it, in the passive or with no object ("`X` workflow was deleted",
//   "`a.yml` and `b.yml` were retired", "`X` workflow, removed in R5", "`X` workflow is gone / no longer exists").
//   "removed / dropped from <something>" is a removal from that something (a schedule, the required checks), not of
//   the workflow, unless the something is the repository or the workflow directory;
// - a move of the work, only with Jenkins as the destination: "<work> moved / migrated / ported / transferred from
//   the `X` workflow to <...> Jenkins <...>", "the `X` workflow was migrated to Jenkins". A move with no destination
//   ("reports transferred from the `X` workflow after each run") is a source relationship, and a move somewhere
//   else ("migrated to a new runner") says the workflow still exists. A present passive ("results are moved from
//   ...") and a data noun as the moved thing ("reports / snapshots / artifacts transferred from ...") describe a
//   recurring provenance, not a departure, and excuse nothing.
// A leaving word elsewhere in the sentence ("... alongside the migrated Jenkins checks") says nothing about the named
// workflow and excuses nothing.
const FILLER_BEFORE = String.raw`(?:(?:ran|run|lived|was|were|in|on|by|of|the|a|an|its|their|GitHub|Actions|old|former|workflows?|files?)\s+|[\`(,]\s*|[\w.-]+\.ya?ml\b\s*)*`;
const MOVE_VERB = String.raw`(?:moved|moves|moving|migrated|migrates|migrating|ported|porting|shifted|transferred|cut over)(?:\s+(?:over|out|away|off))?`;
const DATA_NOUN = String.raw`(?:reports?|results?|data|artifacts?|snapshots?|logs?|metrics|outputs?|history|histories|records?|numbers|values|scores|baselines?|files|telemetry|summar(?:y|ies)|stat(?:s|istics)|trends?|archives?|dashboards?)`;
// "<work> moved from" directly before the mention; the destination is checked after it (TO_JENKINS).
const MOVED_FROM_BEFORE = new RegExp(String.raw`\b${MOVE_VERB}\s+(?:from|out of)\s+${FILLER_BEFORE}$`, "i");
// What was moved is data (a data noun anywhere in the words before the verb, whatever auxiliary or adverb sits
// between: "the telemetry records were transferred from ...") or the move recurs (a present or modal passive, with or
// without an adverb between: "results are / is regularly / will be moved from ..."; a recurrence adverb): that is
// where the data comes from, not a departure of the workflow.
const DATA_BEFORE_VERB = new RegExp(String.raw`\b${DATA_NOUN}\b`, "i");
const PRESENT_PASSIVE_BEFORE_VERB = /\b(?:is|are|gets?|getting|being|(?:will|can|may|should|must|would)\s+be)\s+(?:\w+ly\s+)*$/i;
const RECURRING_ADVERB = /\b(?:regularly|periodically|routinely|often|repeatedly|always|continually|continuously|frequently|constantly|usually|typically|normally|occasionally|sometimes|automatically)\b/i;
function movedWorkIsRecurringData(beforeVerb: string): boolean {
  return DATA_BEFORE_VERB.test(beforeVerb) || PRESENT_PASSIVE_BEFORE_VERB.test(beforeVerb) || RECURRING_ADVERB.test(beforeVerb);
}
const LEFT_BEFORE = new RegExp(String.raw`\b(?:(?:taken|took|takes|taking) over from|formerly|previously|former|retired|deleted|removed|dropped|replaced|replaces|replacing|supersedes|superseded|superseding|instead of|in place of)\s+${FILLER_BEFORE}$`, "i");
const REPLACED_BY_BEFORE = new RegExp(String.raw`\b(?:replaced|superseded|succeeded)\s+(?:by|with)\s+${FILLER_BEFORE}$`, "i");
const LEFT_AFTER_LEAD = /^(?:[\s`(),]|\band\b|\bor\b|[\w.-]+\.ya?ml\b|`[^`]+`|\b(?:files?|workflows?|GitHub|Actions)\b)*/.source;
const AUX = String.raw`(?:was|were|is|are|has|have|had|been|being)`;
const ADV = String.raw`(?:now|since|then|later|all|both|each|fully|also)`;
// The destination of a move: "to / into" a phrase naming Jenkins, within a few words.
const TO_JENKINS = String.raw`,?\s*(?:and\s+)?(?:in)?to\s+(?:[\w\`'-]+\s+){0,5}?\`?Jenkins(?:file)?\b`;
const TO_JENKINS_AFTER_MENTION = new RegExp(String.raw`${LEFT_AFTER_LEAD}${TO_JENKINS}`, "i");
// "`X` workflow is gone / no longer exists".
const GONE_AFTER = new RegExp(String.raw`${LEFT_AFTER_LEAD}(?:(?:${AUX}|${ADV})\s+)*(?:gone|no longer exists?)\b`, "i");
// "`X` workflow was migrated to Jenkins": the workflow itself moved, and only Jenkins is a departure.
const MOVED_AFTER = new RegExp(String.raw`${LEFT_AFTER_LEAD}(?:(?:${AUX}|${ADV})\s+)*${MOVE_VERB}${TO_JENKINS}`, "i");
// What may follow a removal predicate: the end of the clause, a time or agent ("in R5", "when Jenkins took over",
// "by the Jenkins release job"), or "from" the repository / the workflow directory.
const AFTER_REMOVAL = String.raw`(?=\s*(?:$|[.;:,)]|\b(?:in|when|by|with|on|at|during|after|as|and|once|but)\b|from\s+(?:the\s+)?(?:repository|repo|tree|\`?\.github\b|workflows? director(?:y|ies)|default branch|\`?master\`?)))`;
// Transitive ones say the workflow left only in the passive: "`X` workflow was replaced / deleted", or a participle
// with no object ("`X` workflow, deleted in R5"). "The `X` workflow replaced the cron job" makes X the replacement.
const LEFT_AFTER_PASSIVE = new RegExp(String.raw`${LEFT_AFTER_LEAD}(?:(?:${AUX}|${ADV})\s+)*(?:deleted|retired|removed|replaced|superseded|dropped)\b${AFTER_REMOVAL}`, "i");
const LEFT_AFTER_ACTIVE_GUARD = new RegExp(String.raw`${LEFT_AFTER_LEAD}(?:${ADV}\s+)*(?:deleted|retired|removed|replaced|superseded|dropped)\s+(?:the|a|an|its|their|\`)`, "i");

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

// The rest of the mention's own clause: up to a semicolon, or up to a conjunction that opens a new subject ("and the
// README ...", "but `codeql.yml` ..."). A conjunction without a new subject ("... and still runs every Thursday",
// "..., but it still runs") continues the clause about the named workflow.
function clauseAfter(after: string): string {
  const cuts = after.matchAll(/;|,?\s+\b(?:and|but|while|whereas|although|though)\s+(?=(?:the|a|an|this|that|these|those|its|their|[A-Z`])\b|`)/g);
  for (const c of cuts) {
    const next = after.slice((c.index ?? 0) + c[0].length);
    if (!refersBack(next)) return after.slice(0, c.index);
  }
  return after;
}
// A clause that opens with a reference back to the workflow ("that workflow still runs", "the same file ...", "its
// schedule ..."): it is still about the mention, so the mention's clause continues through it.
function refersBack(next: string): boolean {
  return /^\s*(?:(?:this|that|the|these|those)\s+(?:same\s+|said\s+|old\s+|former\s+|retired\s+|original\s+)?(?:GitHub\s+)?(?:Actions\s+)?(?:workflows?|files?|jobs?|pipelines?|schedules?|crons?|triggers?)\b|(?:its|their)\b)/i.test(next);
}
// Said to be still there ("still runs", "remains", "is kept") anywhere in the clause after the mention.
const PERSISTS = /\b(?:still|remains?|stays?|continues?|survives?|retained|kept|preserved)\b/i;
// A recurrence anywhere in the clause after the mention ("after each run", "every Thursday", "weekly."): the workflow
// still runs. A frequency word used as an adjective ("the Jenkins nightly lane") is not a recurrence.
const RECURS = /\bevery\b|\beach\s+(?:run|build|push|commit|tag|release|merge|night|day|week|month|hour|time|cycle|(?:mon|tues|wednes|thurs|fri|satur|sun)day)s?\b|\bper\s+(?:run|build|push|commit|tag|release|night|day|week)\b|\b(?:hourly|daily|nightly|weekly|monthly)\b(?!\s+[a-z])|\bon\s+(?:mon|tues|wednes|thurs|fri|satur|sun)days\b/i;

/** True when the sentence says that this mention's workflow left, in words attached to the mention itself. */
function saysItLeft(sentence: string, m: Mention): boolean {
  const before = sentence.slice(0, m.start);
  const after = sentence.slice(m.end);
  const clause = clauseAfter(after);
  if (PERSISTS.test(clause) || RECURS.test(clause)) return false;
  const movedFrom = MOVED_FROM_BEFORE.exec(before);
  if (movedFrom) return !movedWorkIsRecurringData(before.slice(0, movedFrom.index)) && TO_JENKINS_AFTER_MENTION.test(after);
  if (LEFT_BEFORE.test(before) && !REPLACED_BY_BEFORE.test(before)) return true;
  if (LEFT_AFTER_ACTIVE_GUARD.test(after)) return false;
  return GONE_AFTER.test(after) || MOVED_AFTER.test(after) || LEFT_AFTER_PASSIVE.test(after);
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
 * whatever the verb, unless the mention itself is said to have left (saysItLeft).
 */
function retainedWorkflowClaims(section: string, workflows: Record<string, string>, otherFiles: Set<string>): string[] {
  const have = workflowNames(workflows);
  const problems: string[] = [];
  for (const sentence of sentencesOf(section)) {
    const files = fileMentions(sentence);
    const titles = titleMentions(sentence);
    for (const m of files) {
      if (!have.has(m.name) && !otherFiles.has(m.name) && !saysItLeft(sentence, m)) problems.push(`names ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    for (const m of titles) {
      if (!have.has(m.name) && !saysItLeft(sentence, m)) problems.push(`names workflow ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
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
  ])("is accepted: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, new Set(["dependabot.yml"]))).toEqual([]);
  });
});
