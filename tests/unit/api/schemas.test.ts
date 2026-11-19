import { describe, expect, it } from 'vitest';
import {
  parseLanguagePairs,
  parseLearnablesPage,
  parseScenarioDetails,
  parseScenariosPage,
} from '../../../src/api/schemas.js';
import { MalformedResponseError } from '../../../src/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

type Body = Record<string, unknown>;

/** A deep copy of a real fixture, so a test can break one field without touching the shared file. */
function fixtureCopy(name: string): Body {
  return structuredClone(loadFixture<Body>(name));
}

/** The first element of a list in a copied fixture; tests mutate it to simulate a broken response. */
function firstItem(body: Body, listKey: string): Body {
  return (body[listKey] as Body[])[0];
}

describe('parseLanguagePairs', () => {
  it('maps the real language-pairs fixture to a domain pair', () => {
    expect(parseLanguagePairs(loadFixture('language-pairs.json'))).toEqual([
      {
        id: 7,
        sourceName: 'Alpha',
        targetName: 'Beta',
        sourceLocale: 'aa-aa',
        targetLocale: 'bb',
      },
    ]);
  });

  it('rejects a body that is not an object, naming only the step', () => {
    expect(() => parseLanguagePairs(null)).toThrow(new MalformedResponseError('language_pairs'));
  });
});

describe('parseLearnablesPage', () => {
  it('maps the first learnables page and returns its next page token', () => {
    const page = parseLearnablesPage(loadFixture('learnables-page-1.json'));

    expect(page.nextPageToken).toBe('<page-token-1>');
    expect(page.items).toHaveLength(10);
    expect(page.items[0]).toEqual({
      id: 65500000065536,
      source: 'tr: the book',
      target: 'the book',
      audios: ['https://static.memrise.example/audio/1_m.mp3'],
      growthLevel: 13,
      known: false,
      difficult: false,
      nextReview: '2030-01-01T00:00:00Z',
      learned: true,
      heard: false,
    });
  });

  it('reads heard from the raw item, and treats a missing flag as false', () => {
    const body = fixtureCopy('learnables-page-1.json');
    const items = body.learnables as Body[];
    items[0].heard = true;
    delete items[1].heard;

    const page = parseLearnablesPage(body);

    expect(page.items[0].heard).toBe(true);
    expect(page.items[1].heard).toBe(false);
  });

  it('returns a null next page token on the last page', () => {
    expect(parseLearnablesPage(loadFixture('learnables-page-last.json')).nextPageToken).toBeNull();
  });

  it('rejects an item without learnable_id_key, naming only the step', () => {
    const body = fixtureCopy('learnables-page-1.json');
    delete firstItem(body, 'learnables').learnable_id_key;

    expect(() => parseLearnablesPage(body)).toThrow(new MalformedResponseError('learnables_page'));
  });
});

describe('parseScenariosPage', () => {
  it('maps the first completed page: five scenarios, more pages to come, total 6', () => {
    const page = parseScenariosPage(loadFixture('scenarios-completed-page-1.json'));

    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(6);
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toEqual({
      id: 2005,
      title: 'Lesson Alpha',
      topic: { id: 11, name: 'Topic One' },
      numberOfLearnables: 26,
      itemsLearned: 26,
      progressPercent: 100,
    });
  });

  it('maps the last completed page to one scenario with no more pages', () => {
    const page = parseScenariosPage(loadFixture('scenarios-completed-page-last.json'));

    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => item.id)).toEqual([2000]);
  });

  it('maps the empty in-progress fixture to no scenarios', () => {
    expect(parseScenariosPage(loadFixture('scenarios-in-progress.json'))).toEqual({
      items: [],
      hasMore: false,
      total: 0,
    });
  });

  it('accepts a scenario whose topic is null', () => {
    const body = fixtureCopy('scenarios-completed-page-1.json');
    firstItem(body, 'scenarios').topic = null;

    expect(parseScenariosPage(body).items[0].topic).toBeNull();
  });

  it('rejects a scenario whose topic is a string', () => {
    const body = fixtureCopy('scenarios-completed-page-1.json');
    firstItem(body, 'scenarios').topic = 'Topic One';

    expect(() => parseScenariosPage(body)).toThrow(new MalformedResponseError('scenarios_page'));
  });

  it('rejects a scenario without progress', () => {
    const body = fixtureCopy('scenarios-completed-page-1.json');
    delete firstItem(body, 'scenarios').progress;

    expect(() => parseScenariosPage(body)).toThrow(new MalformedResponseError('scenarios_page'));
  });
});

describe('parseScenarioDetails', () => {
  it('maps the 1001 details fixture, taking the scenario id from the request', () => {
    const details = parseScenarioDetails(1001, loadFixture('scenario-details-1001.json'));

    expect(details.scenarioId).toBe(1001);
    expect(details.completed).toBe(true);
    expect(details.dateStarted).toBe('2030-01-01T10:00:00.000000Z');
    expect(details.dateCompleted).toBe('2030-01-01T10:12:00.000000Z');
    expect(details.learnables).toHaveLength(10);
    expect(details.learnables[0]).toEqual({
      id: 65530000065536,
      target: 'the table',
      source: 'tr: the table',
      growthLevel: 10,
      alreadyKnown: false,
      difficult: false,
    });
  });

  it('keeps the phrase learnable from the 1001 fixture', () => {
    const details = parseScenarioDetails(1001, loadFixture('scenario-details-1001.json'));

    expect(details.learnables.map((item) => item.target)).toContain('the plate is on the table');
  });

  it('rejects a details item without learnable_id, naming only the step', () => {
    const body = fixtureCopy('scenario-details-1001.json');
    delete firstItem(body, 'learnables').learnable_id;

    expect(() => parseScenarioDetails(1001, body)).toThrow(new MalformedResponseError('scenario_details'));
  });
});
