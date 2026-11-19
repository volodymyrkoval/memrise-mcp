import type { LessonRef, Scenario, ScenarioDetails } from './types.js';

/**
 * Word ↔ lesson join: maps each learnable id to the lessons that teach it, in scenario order.
 * Scenarios without a details entry (failed or not yet fetched) are skipped; the caller reports them.
 */
export function buildLessonIndex(
  scenarios: readonly Scenario[],
  detailsById: ReadonlyMap<number, ScenarioDetails>,
): Map<number, LessonRef[]> {
  const index = new Map<number, LessonRef[]>();
  for (const scenario of scenarios) {
    const details = detailsById.get(scenario.id);
    if (details === undefined) continue;
    const ref = lessonRefFor(scenario);
    for (const learnable of details.learnables) appendUnique(index, learnable.id, ref);
  }
  return index;
}

function lessonRefFor(scenario: Scenario): LessonRef {
  return { scenarioId: scenario.id, title: scenario.title, topic: scenario.topic?.name ?? null };
}

function appendUnique(index: Map<number, LessonRef[]>, learnableId: number, ref: LessonRef): void {
  const refs = index.get(learnableId);
  if (refs === undefined) {
    index.set(learnableId, [ref]);
  } else if (!refs.some((existing) => existing.scenarioId === ref.scenarioId)) {
    refs.push(ref);
  }
}
