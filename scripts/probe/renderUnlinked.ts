import { failuresBlock, type ProbeFailure } from './renderReport.js';
import { invalidRunReason, type CandidateFinding, type ListingOutcome, type FlagTally, type UnlinkedFindings } from './probeUnlinked.js';

/** Markdown for `.probe-out/unlinked.md`: counts, statuses and key sets only; never an id, a token or a word. */
export function renderUnlinkedReport(findings: UnlinkedFindings | undefined, failures: readonly ProbeFailure[] = []): string {
  if (findings === undefined) return ['# Unlinked words probe', '', failuresBlock([...failures]), '_not run_', ''].join('\n');
  const { walk, lessons, unlinked, linked } = findings;
  const invalid = invalidRunReason(lessons);
  if (invalid !== undefined) return renderInvalid(findings, invalid, failures);
  return [
    '# Unlinked words probe',
    '',
    failuresBlock([...failures]),
    '## Counts',
    '',
    `- Words walked (learning_state ANY): ${walk.items} in ${walk.pages} page(s), stopped by ${walk.stoppedBy}`,
    `- Lessons listed: ${lessons.listed}; details fetched: ${lessons.fetched}; failed: ${lessons.failed}`,
    ...(lessons.capped ? ['- Only the first 200 lessons were fetched, so the unlinked count is an upper bound.'] : []),
    ...(lessons.failed > 0 ? ['- Some lessons failed, so words of those lessons count as unlinked.'] : []),
    `- Unlinked words: ${unlinked.total}`,
    `- Linked words: ${linked.total}`,
    '',
    '## Raw flags, unlinked against linked',
    '',
    '| Flag | Unlinked | Linked |',
    '|---|---|---|',
    ...flagRows(unlinked, linked),
    '',
    '## Key set of an unlinked item',
    '',
    findings.unlinkedShape ?? '_no unlinked words_',
    '',
    ...lookupSection(findings.candidates),
    '## Candidate endpoints',
    '',
    ...findings.candidates.map((candidate) => candidateLine(candidate)),
    '',
  ].join('\n');
}

function renderInvalid(findings: UnlinkedFindings, reason: string, failures: readonly ProbeFailure[]): string {
  const { walk, lessons } = findings;
  const rejected = lessons.listing.filter((outcome) => outcome.failedStatus !== undefined);
  return [
    '# Unlinked words probe',
    '',
    `## INVALID RUN: ${reason}; the comparison below cannot be trusted`,
    '',
    failuresBlock([...failures]),
    '## Counts',
    '',
    `- Words walked (learning_state ANY): ${walk.items} in ${walk.pages} page(s), stopped by ${walk.stoppedBy}`,
    `- Lessons listed: ${lessons.listed}; details fetched: ${lessons.fetched}; failed: ${lessons.failed}`,
    '- Linked and unlinked counts are left out: they would count every word as unlinked.',
    '',
    '## Lesson listing',
    '',
    ...lessons.listing.map(listingLine),
    ...(rejected.length === 0 ? [] : ['', '(the key names above are those of the rejected answer; values are never printed)']),
    '',
    '## Candidate endpoints',
    '',
    ...findings.candidates.map((candidate) => candidateLine(candidate, false)),
    '',
  ].join('\n');
}

function listingLine(outcome: ListingOutcome): string {
  if (outcome.failedStatus === undefined) return `- ${outcome.type}: ${outcome.pages} page(s) listed`;
  return `- ${outcome.type}: HTTP ${outcome.failedStatus} after ${outcome.pages} page(s); answer shape: ${outcome.errorShape}`;
}

const FLAG_ROWS: ReadonlyArray<[string, keyof FlagTally]> = [
  ['learned', 'learned'],
  ['known', 'known'],
  ['heard', 'heard'],
  ['used', 'used'],
  ['excluded', 'excluded'],
  ['difficult', 'difficult'],
  ['due_for_review', 'dueForReview'],
  ['growth_level 0', 'growthZero'],
  ['next_review in the past', 'reviewInPast'],
  ['audios non-empty', 'audiosNonEmpty'],
  ['romanization present', 'withRomanization'],
  ['native_script present', 'withNativeScript'],
];

function flagRows(unlinked: FlagTally, linked: FlagTally): string[] {
  return FLAG_ROWS.map(([name, key]) => `| ${name} | ${unlinked[key]} of ${unlinked.total} | ${linked[key]} of ${linked.total} |`);
}

function candidateLine(candidate: CandidateFinding, withUnlinkedIds = true): string {
  const total = candidate.total === undefined ? '' : `, total ${candidate.total}`;
  const contained = candidate.unlinkedIdsContained;
  const ids = contained === undefined || !withUnlinkedIds ? '' : `, contains ${contained.matched} of ${contained.of} unlinked ids`;
  return `- ${candidate.label} (${candidate.path}): HTTP ${candidate.status}${total}${ids}; shape: ${candidate.shape}`;
}

/** Whether a lookup by id could stand in for a lesson: which review-state fields its answer carries. */
function lookupSection(candidates: readonly CandidateFinding[]): string[] {
  const lookups = candidates.flatMap((candidate) => (candidate.lookup === undefined ? [] : [[candidate, candidate.lookup] as const]));
  if (lookups.length === 0) return [];
  return [
    '## Single-learnable lookup',
    '',
    ...lookups.map(([candidate, facts]) => {
      const lacks = facts.lacksFlagFields.length === 0 ? 'lacks none' : `lacks ${facts.lacksFlagFields.join(', ')}`;
      return `- ${candidate.label} (${candidate.path}): has ${facts.hasFlagFields.join(', ') || 'none'}; ${lacks}; fields: ${facts.fields.join(', ')}`;
    }),
    '',
  ];
}
