import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchJson, HttpError, createCache } from '../src/lib/http.js';

let server;
let base;
let hits = 0;

before(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/flaky') {
      if (hits < 3) return res.writeHead(503).end('nope');
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    }
    if (req.url === '/ratelimited') {
      if (hits < 2) return res.writeHead(429, { 'retry-after': '1' }).end('slow');
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    }
    if (req.url === '/notfound') return res.writeHead(404).end('missing');
    if (req.url === '/hang') return; // never responds
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

describe('fetchJson retries', () => {
  test('retries 5xx then succeeds', async () => {
    hits = 0;
    assert.deepEqual(await fetchJson(`${base}/flaky`), { ok: true });
    assert.equal(hits, 3);
  });

  test('honours Retry-After on 429', async () => {
    hits = 0;
    const started = Date.now();
    assert.deepEqual(await fetchJson(`${base}/ratelimited`), { ok: true });
    // The header said 1 second; anything much faster means it was ignored.
    assert.ok(Date.now() - started >= 900, 'should have waited ~1s');
  });

  test('never retries 4xx — a bad key will not fix itself', async () => {
    hits = 0;
    await assert.rejects(() => fetchJson(`${base}/notfound`), (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 404);
      return true;
    });
    assert.equal(hits, 1);
  });

  test('autocomplete settings stay inside Discord 3s budget', async () => {
    // The regression this guards: /steam autocomplete once inherited an 8s
    // timeout and 2 retries against a 3s deadline, so it could never answer.
    const started = Date.now();
    await assert.rejects(() =>
      fetchJson(`${base}/hang`, { timeoutMs: 2000, retries: 0 }),
    );
    assert.ok(Date.now() - started < 3000, 'must give up before Discord stops listening');
  });
});

describe('createCache', () => {
  test('serves the cached value without re-running the producer', async () => {
    const cache = createCache({ ttlMs: 60_000 });
    let calls = 0;
    const produce = async () => { calls++; return 'value'; };
    assert.equal(await cache.wrap('k', produce), 'value');
    assert.equal(await cache.wrap('k', produce), 'value');
    assert.equal(calls, 1);
  });

  test('re-runs once the entry expires', async () => {
    const cache = createCache({ ttlMs: 1 });
    let calls = 0;
    const produce = async () => { calls++; return calls; };
    await cache.wrap('k', produce);
    await new Promise((r) => setTimeout(r, 10));
    await cache.wrap('k', produce);
    assert.equal(calls, 2);
  });

  test('evicts the oldest entry past maxEntries', async () => {
    const cache = createCache({ ttlMs: 60_000, maxEntries: 2 });
    await cache.wrap('a', async () => 1);
    await cache.wrap('b', async () => 2);
    await cache.wrap('c', async () => 3);
    let recomputed = false;
    await cache.wrap('a', async () => { recomputed = true; return 1; });
    assert.ok(recomputed, '"a" should have been evicted');
  });
});
