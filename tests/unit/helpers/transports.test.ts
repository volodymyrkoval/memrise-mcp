import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse } from '../../../src/http/transport.js';
import { RoutedTransport } from '../../helpers/routedTransport.js';
import { ScriptedTransport } from '../../helpers/scriptedTransport.js';

const GET_LANGUAGE_PAIRS: HttpRequest = {
  method: 'GET',
  url: 'https://app.memrise.com/v1.25/me/language_pairs/',
  headers: {},
};

function response(status: number, bodyText = ''): HttpResponse {
  return { status, setCookies: [], bodyText };
}

describe('ScriptedTransport', () => {
  it('returns enqueued responses in order and records every request it receives', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(response(200, 'first'));
    transport.enqueue(response(503));

    const first = await transport.send(GET_LANGUAGE_PAIRS);
    const second = await transport.send(GET_LANGUAGE_PAIRS);

    expect(first.bodyText).toBe('first');
    expect(second.status).toBe(503);
    expect(transport.requests).toEqual([GET_LANGUAGE_PAIRS, GET_LANGUAGE_PAIRS]);
  });

  it('rejects with the queued error to simulate a network failure', async () => {
    const transport = new ScriptedTransport();
    const failure = new TypeError('fetch failed');
    transport.enqueue(failure);

    await expect(transport.send(GET_LANGUAGE_PAIRS)).rejects.toBe(failure);
  });

  it('fails loudly when a request has no scripted response left', async () => {
    const transport = new ScriptedTransport();

    await expect(transport.send(GET_LANGUAGE_PAIRS)).rejects.toThrow('no scripted response left');
  });
});

describe('RoutedTransport', () => {
  it('answers with the first route whose method and path prefix match, and 404 otherwise', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/language_pairs/', response(200, 'pairs'));

    const matched = await transport.send(GET_LANGUAGE_PAIRS);
    const wrongMethod = await transport.send({ ...GET_LANGUAGE_PAIRS, method: 'POST' });
    const unrouted = await transport.send({ ...GET_LANGUAGE_PAIRS, url: 'https://app.memrise.com/v1.25/other/' });

    expect(matched.bodyText).toBe('pairs');
    expect(wrongMethod.status).toBe(404);
    expect(unrouted.status).toBe(404);
  });
});

describe('RoutedTransport with function responses', () => {
  it('builds the response from the request it matched', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/scenarios/', (req) => response(200, new URL(req.url).search));

    const result = await transport.send({
      ...GET_LANGUAGE_PAIRS,
      url: 'https://app.memrise.com/v1.25/me/scenarios/?limit=20',
    });

    expect(result.bodyText).toBe('?limit=20');
  });
});

describe('RoutedTransport query matching', () => {
  it('matches only requests whose query contains every required parameter', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/learnables/', { learning_state: 'any' }, response(200, 'any-state'));

    const withState = await transport.send({
      ...GET_LANGUAGE_PAIRS,
      url: 'https://app.memrise.com/v1.25/me/learnables/?learning_state=any&page_size=50',
    });
    const otherState = await transport.send({
      ...GET_LANGUAGE_PAIRS,
      url: 'https://app.memrise.com/v1.25/me/learnables/?learning_state=fully_learned_or_known',
    });

    expect(withState.bodyText).toBe('any-state');
    expect(otherState.status).toBe(404);
  });
});

describe('RoutedTransport countFor', () => {
  it('counts every request under a path prefix, matched or not', async () => {
    const transport = new RoutedTransport();
    transport.route('GET', '/v1.25/me/scenarios/', response(200));
    const base = 'https://app.memrise.com';

    await transport.send({ ...GET_LANGUAGE_PAIRS, url: `${base}/v1.25/me/scenarios/?offset=0` });
    await transport.send({ ...GET_LANGUAGE_PAIRS, url: `${base}/v1.25/me/scenarios/?offset=20` });
    await transport.send({ ...GET_LANGUAGE_PAIRS, url: `${base}/v1.25/me/scenarios/1001/details/` });
    await transport.send({ ...GET_LANGUAGE_PAIRS, url: `${base}/v1.25/me/language_pairs/` });

    expect(transport.countFor('/v1.25/me/scenarios/')).toBe(3);
    expect(transport.countFor('/v1.25/me/scenarios/1001/details/')).toBe(1);
  });
});
