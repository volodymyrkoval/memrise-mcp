/**
 * Test double for `HttpTransport`: replays queued responses (or errors) in FIFO order
 * and records every request it was asked to send.
 */
import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/http/transport.js';

export class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  readonly #queue: Array<HttpResponse | Error> = [];

  enqueue(item: HttpResponse | Error): void {
    this.#queue.push(item);
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const next = this.#queue.shift();
    if (next === undefined) throw new Error('ScriptedTransport: no scripted response left');
    if (next instanceof Error) throw next;
    return next;
  }
}
