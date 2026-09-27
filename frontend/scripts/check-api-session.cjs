// Exercises the real API module with controlled HTTP responses and fixture tokens.
// No network requests or browser storage are used by these checks.
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');

const tests = [];
const test = (name, run) => tests.push({ name, run });
const sessionToken = 'fixture-app-session';
const legacyMessages = [
  'Invalid or expired access token',
  'Invalid access token',
  'Bearer access token is required',
];
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

async function withApi(respond, check) {
  const originalFetch = global.fetch;
  const calls = [];
  const api = loadSource('api');
  assert.equal(typeof api.subscribeToSessionInvalidation, 'function');
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  };
  try {
    await check(api, calls);
  } finally {
    global.fetch = originalFetch;
  }
}

function assertApiError(api, error, status, message) {
  assert.ok(error instanceof api.ApiError);
  assert.equal(error.name, 'ApiError');
  assert.equal(error.status, status);
  assert.equal(error.message, message);
  return true;
}

test('structured session 401 notifies all subscribers with the request token before rejection', async () => {
  const message = '로그인 세션이 만료되었습니다.';
  await withApi(
    () => jsonResponse({ code: 'AUTH_SESSION_INVALID', message }, 401),
    async (api, calls) => {
      const events = [];
      api.subscribeToSessionInvalidation((token) => events.push(['first', token]));
      api.subscribeToSessionInvalidation((token) => events.push(['second', token]));
      await assert.rejects(
        api.apiRequest('/careers', { token: sessionToken }),
        (error) => {
          assert.deepEqual(events, [
            ['first', sessionToken],
            ['second', sessionToken],
          ]);
          return assertApiError(api, error, 401, message);
        },
      );
      assert.equal(calls.length, 1);
    },
  );
});

for (const message of legacyMessages) {
  test(`legacy guard 401 invalidates the authenticated request: ${message}`, async () => {
    await withApi(
      () => jsonResponse({ statusCode: 401, message, error: 'Unauthorized' }, 401),
      async (api) => {
        const tokens = [];
        api.subscribeToSessionInvalidation((token) => tokens.push(token));
        await assert.rejects(
          api.apiRequest('/careers/1', { token: sessionToken }),
          (error) => assertApiError(api, error, 401, message),
        );
        assert.deepEqual(tokens, [sessionToken]);
      },
    );
  });
}

test('unsubscribe removes only that subscriber and is safe to repeat', async () => {
  await withApi(
    () => jsonResponse({ code: 'AUTH_SESSION_INVALID', message: 'Expired' }, 401),
    async (api) => {
      const removed = [];
      const active = [];
      const unsubscribe = api.subscribeToSessionInvalidation((token) => removed.push(token));
      api.subscribeToSessionInvalidation((token) => active.push(token));
      await assert.rejects(api.apiRequest('/careers', { token: 'fixture-old-session' }));
      unsubscribe();
      unsubscribe();
      await assert.rejects(api.apiRequest('/careers', { token: 'fixture-new-session' }));
      assert.deepEqual(removed, ['fixture-old-session']);
      assert.deepEqual(active, ['fixture-old-session', 'fixture-new-session']);
    },
  );
});

for (const token of [undefined, null, '']) {
  for (const body of [
    { code: 'AUTH_SESSION_INVALID', message: 'Expired' },
    { message: legacyMessages[0] },
  ]) {
    test(`session-shaped 401 without an authenticated token does not notify (${JSON.stringify(token)}, ${body.code ?? 'legacy'})`, async () => {
      await withApi(
        () => jsonResponse(body, 401),
        async (api) => {
          const events = [];
          api.subscribeToSessionInvalidation((value) => events.push(value));
          await assert.rejects(
            api.apiRequest('/auth/login', { token }),
            (error) => assertApiError(api, error, 401, body.message),
          );
          assert.deepEqual(events, []);
        },
      );
    });
  }
}

for (const [path, body] of [
  ['/auth/login', { message: 'Invalid email or password' }],
  ['/auth/google/login', { message: 'Invalid or expired Google identity token' }],
  ['/auth/google/link', { code: 'GOOGLE_IDENTITY_INVALID', message: 'Invalid Google credential' }],
  ['/auth/google/link', { message: 'Invalid or expired access token for Google identity' }],
]) {
  for (const token of [undefined, sessionToken]) {
    test(`ordinary credential 401 does not invalidate an app session (${path}, ${token ? 'authenticated' : 'anonymous'}, ${body.message})`, async () => {
      await withApi(
        () => jsonResponse(body, 401),
        async (api, calls) => {
          const events = [];
          api.subscribeToSessionInvalidation((value) => events.push(value));
          await assert.rejects(
            api.apiRequest(path, { method: 'POST', token, body: { credential: 'fixture-credential' } }),
            (error) => assertApiError(api, error, 401, body.message),
          );
          assert.deepEqual(events, []);
          assert.equal(calls.length, 1);
        },
      );
    });
  }
}

for (const status of [403, 500]) {
  test(`HTTP ${status} does not invalidate even with session-shaped error details`, async () => {
    await withApi(
      () => jsonResponse({ code: 'AUTH_SESSION_INVALID', message: legacyMessages[0] }, status),
      async (api, calls) => {
        const events = [];
        api.subscribeToSessionInvalidation((token) => events.push(token));
        await assert.rejects(
          api.apiRequest('/careers', { token: sessionToken }),
          (error) => assertApiError(api, error, status, legacyMessages[0]),
        );
        assert.deepEqual(events, []);
        assert.equal(calls.length, 1);
      },
    );
  });
}

test('network rejection propagates unchanged without session invalidation or retry', async () => {
  const networkError = new TypeError('Failed to fetch');
  await withApi(
    () => { throw networkError; },
    async (api, calls) => {
      const events = [];
      api.subscribeToSessionInvalidation((token) => events.push(token));
      await assert.rejects(
        api.apiRequest('/careers/1/matches', { method: 'POST', token: sessionToken, body: {} }),
        (error) => error === networkError,
      );
      assert.deepEqual(events, []);
      assert.equal(calls.length, 1);
    },
  );
});

test('session invalidation never automatically replays a mutating POST', async () => {
  await withApi(
    () => jsonResponse({ code: 'AUTH_SESSION_INVALID', message: 'Expired' }, 401),
    async (api, calls) => {
      const events = [];
      api.subscribeToSessionInvalidation((token) => events.push(token));
      await assert.rejects(
        api.apiRequest('/careers/1/matches', {
          method: 'POST',
          token: sessionToken,
          body: { simulate: true },
        }),
        (error) => assertApiError(api, error, 401, 'Expired'),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(events, [sessionToken]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.method, 'POST');
      assert.equal(calls[0].options.body, JSON.stringify({ simulate: true }));
    },
  );
});

test('successful JSON request preserves body, authorization, custom headers and fetch options', async () => {
  const result = { id: 42, name: 'Fixture career' };
  await withApi(
    () => jsonResponse(result, 201),
    async (api, calls) => {
      const events = [];
      const controller = new AbortController();
      const headers = new Headers({ 'X-Google-Auth': '1' });
      api.subscribeToSessionInvalidation((token) => events.push(token));
      assert.deepEqual(await api.apiRequest('/careers', {
        method: 'POST',
        token: sessionToken,
        body: { clubCode: 'T1' },
        headers,
        signal: controller.signal,
        credentials: 'include',
      }), result);
      assert.deepEqual(events, []);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/careers');
      const request = calls[0].options;
      assert.equal(request.method, 'POST');
      assert.equal(request.body, JSON.stringify({ clubCode: 'T1' }));
      assert.equal(request.headers.get('Accept'), 'application/json');
      assert.equal(request.headers.get('Content-Type'), 'application/json');
      assert.equal(request.headers.get('Authorization'), `Bearer ${sessionToken}`);
      assert.equal(request.headers.get('X-Google-Auth'), '1');
      assert.equal(request.signal, controller.signal);
      assert.equal(request.credentials, 'include');
      assert.equal(headers.has('Authorization'), false, 'Caller-owned headers stay unchanged');
    },
  );
});

test('successful text response keeps anonymous GET behavior and never notifies', async () => {
  await withApi(
    () => new Response('ready', { headers: { 'Content-Type': 'text/plain' } }),
    async (api, calls) => {
      const events = [];
      api.subscribeToSessionInvalidation((token) => events.push(token));
      assert.equal(await api.apiRequest('/health'), 'ready');
      assert.deepEqual(events, []);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.body, undefined);
      assert.equal(calls[0].options.headers.has('Authorization'), false);
      assert.equal(calls[0].options.headers.has('Content-Type'), false);
    },
  );
});

(async () => {
  for (const { name, run } of tests) {
    try {
      await run();
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  console.log(`API session regression checks passed: ${tests.length} scenarios (real api.ts; controlled fetch only).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
