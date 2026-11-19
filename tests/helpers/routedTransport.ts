/**
 * Test double for `HttpTransport` that answers by route: the first route whose method, path
 * prefix and (optional) query parameters match wins; anything unmatched gets a 404 so a
 * missing route fails loudly.
 */
import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/http/transport.js';

/** A fixed response, or a function that builds one from the matched request. */
export type RouteResponse = HttpResponse | ((req: HttpRequest) => HttpResponse);

/** Query parameters the request must carry; extra parameters are allowed. */
export type RequiredQuery = Record<string, string>;

interface Route {
  method: HttpRequest['method'];
  pathPrefix: string;
  requiredQuery: RequiredQuery;
  respond: RouteResponse;
}

const UNROUTED: HttpResponse = { status: 404, setCookies: [], bodyText: '' };

export class RoutedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  readonly #routes: Route[] = [];

  route(method: HttpRequest['method'], pathPrefix: string, respond: RouteResponse): void;
  route(method: HttpRequest['method'], pathPrefix: string, requiredQuery: RequiredQuery, respond: RouteResponse): void;
  route(
    method: HttpRequest['method'],
    pathPrefix: string,
    queryOrRespond: RequiredQuery | RouteResponse,
    maybeRespond?: RouteResponse,
  ): void {
    const hasQuery = maybeRespond !== undefined;
    const respond = hasQuery ? maybeRespond : (queryOrRespond as RouteResponse);
    const requiredQuery = hasQuery ? (queryOrRespond as RequiredQuery) : {};
    this.#routes.push({ method, pathPrefix, requiredQuery, respond });
  }

  /** Number of requests (matched or not) whose path starts with `pathPrefix`. */
  countFor(pathPrefix: string): number {
    return this.requests.filter((req) => new URL(req.url).pathname.startsWith(pathPrefix)).length;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const match = this.#routes.find((route) => matches(route, req));
    if (match === undefined) return UNROUTED;
    return typeof match.respond === 'function' ? match.respond(req) : match.respond;
  }
}

function matches(route: Route, req: HttpRequest): boolean {
  const url = new URL(req.url);
  if (route.method !== req.method || !url.pathname.startsWith(route.pathPrefix)) return false;
  return Object.entries(route.requiredQuery).every(([name, value]) => url.searchParams.get(name) === value);
}
