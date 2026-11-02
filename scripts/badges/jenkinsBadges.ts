// Pure derivation of the four Jenkins embeddable badges (`tests`, `coverage`, `quality`, `mutation`) from the
// report data the pipeline already has (no I/O). `jenkins.ts` (`npm run badges:ci`) reads the files and writes one
// `<id>=<status>|<color>` line per badge for the Jenkinsfile's `addEmbeddableBadgeConfiguration` calls; `build` is the
// Jenkins plugin's own badge and needs no data.
import { colorForThreshold, type BadgeColor, type BadgeInput } from './badges.ts';

export const JENKINS_BADGE_IDS = ['build', 'tests', 'coverage', 'quality', 'mutation'] as const;
export type JenkinsBadgeId = (typeof JENKINS_BADGE_IDS)[number];

/** The badges this module computes; `build` comes from the plugin. */
export type ComputedBadgeId = Exclude<JenkinsBadgeId, 'build'>;

export interface JenkinsBadge {
  status: string;
  color: BadgeColor;
}

const NOT_RUN: JenkinsBadge = { status: 'not run', color: 'lightgrey' };
const round = (value: number): number => Math.round(value * 100) / 100;

/** Unit and e2e results together: red on any failed test or e2e report error, green otherwise; nothing run is 'not run'. */
function testsBadge(input: BadgeInput): JenkinsBadge {
  if (!input.unit && !input.e2e) return NOT_RUN;
  const unitPassed = input.unit ? input.unit.total - input.unit.failed - input.unit.skipped : 0;
  const passed = unitPassed + (input.e2e?.passed ?? 0);
  const failed = (input.unit?.failed ?? 0) + (input.e2e?.failed ?? 0) + (input.e2e?.errors ?? 0);
  return failed > 0 ? { status: `${failed} failed`, color: 'red' } : { status: `${passed} passed`, color: 'brightgreen' };
}

/** Line coverage against the ratchet floor, the colour rule of the endpoint badges. */
function coverageBadge(input: BadgeInput): JenkinsBadge {
  if (!input.coverage) return NOT_RUN;
  const value = input.coverage.pct.lines;
  const floor = input.ratchet?.coverageThresholds.lines;
  return { status: `${round(value)}%`, color: floor === undefined ? 'lightgrey' : colorForThreshold(value, floor) };
}

/** Passing only with no CRAP offender and no ESLint error or warning; either report alone is judged, none is 'not run'. */
function qualityBadge(input: BadgeInput): JenkinsBadge {
  if (!input.lint && !input.crap) return NOT_RUN;
  const clean = (input.lint === null || (input.lint.errors === 0 && input.lint.warnings === 0)) && (input.crap === null || input.crap.over === 0);
  return clean ? { status: 'passing', color: 'brightgreen' } : { status: 'failing', color: 'red' };
}

function mutationBadge(input: BadgeInput): JenkinsBadge {
  if (input.mutation === null) return NOT_RUN;
  const floor = input.ratchet?.mutationScoreMin;
  return { status: `${round(input.mutation)}%`, color: floor === undefined ? 'lightgrey' : colorForThreshold(input.mutation, floor) };
}

export function jenkinsBadges(input: BadgeInput): Record<ComputedBadgeId, JenkinsBadge> {
  return { tests: testsBadge(input), coverage: coverageBadge(input), quality: qualityBadge(input), mutation: mutationBadge(input) };
}

/** `id=status|color` lines, one per badge, the format the Jenkinsfile parses. */
export function renderBadgeLines(badges: Record<ComputedBadgeId, JenkinsBadge>): string {
  return Object.entries(badges).map(([id, badge]) => `${id}=${badge.status}|${badge.color}\n`).join('');
}
