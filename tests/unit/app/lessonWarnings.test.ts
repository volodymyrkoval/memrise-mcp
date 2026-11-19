import { describe, expect, it } from 'vitest';
import { formatLessonWarning, withWarnings } from '../../../src/app/lessonWarnings.js';

const LESSON_GAMMA_FAILURE = { scenarioId: 2003, title: 'Lesson Gamma', reason: 'HTTP 503' };

describe('formatLessonWarning', () => {
  it('names the lesson, its title and the reason, and says what the result lacks', () => {
    expect(formatLessonWarning(LESSON_GAMMA_FAILURE)).toBe(
      'Could not read lesson 2003 "Lesson Gamma" (Memrise error HTTP 503), so its words show no lesson or topic in this result.',
    );
  });
});

describe('formatLessonWarning reasons', () => {
  it('names a network failure without calling it a Memrise error', () => {
    expect(formatLessonWarning({ scenarioId: 2003, title: 'Lesson Gamma', reason: 'network error' })).toBe(
      'Could not read lesson 2003 "Lesson Gamma" (network error), so its words show no lesson or topic in this result.',
    );
  });
});

describe('withWarnings', () => {
  it('leaves the warnings key out entirely when nothing failed', () => {
    const result = withWarnings({ words: [] }, []);

    expect(result).toEqual({ words: [] });
    expect(Object.keys(result)).not.toContain('warnings');
  });

  it('adds one formatted warning per failed lesson', () => {
    const result = withWarnings({ words: [1] }, [LESSON_GAMMA_FAILURE]);

    expect(result).toEqual({
      words: [1],
      warnings: [formatLessonWarning(LESSON_GAMMA_FAILURE)],
    });
  });

  it('appends extra notes after the lesson warnings, only when a lesson failed', () => {
    expect(withWarnings({ words: [] }, [LESSON_GAMMA_FAILURE], ['note'])).toEqual({
      words: [],
      warnings: [formatLessonWarning(LESSON_GAMMA_FAILURE), 'note'],
    });
    expect(withWarnings({ words: [] }, [], ['note'])).toEqual({ words: [] });
  });
});
