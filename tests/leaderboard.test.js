const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'leaderboard.js'), 'utf8');

function createHarness(fetchHandler, options = {}) {
  const storage = new Map(Object.entries(options.initialStorage || {}));
  const requests = [];
  let clientCount = 0;
  let signInCount = 0;
  let clientAuthOptions;
  let online = true;
  let session = options.session || null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => {
        signInCount++;
        if (options.signInFailure) return { data: { user: null }, error: new Error('sign in failed') };
        session = { user: { id: 'anonymous-user' }, access_token: 'user-access-token' };
        return { data: { user: session.user }, error: null };
      }
    },
    channel: () => ({
      on() { return this; },
      subscribe() { return this; }
    }),
    removeChannel() {}
  };
  const windowEvents = new Map();
  const window = {
    APP_CONFIG: {
      SUPABASE_URL: 'https://example.supabase.co/',
      SUPABASE_ANON_KEY: 'sb_publishable_test-key'
    },
    supabase: {
      createClient(url, key, clientOptions) {
        clientCount++;
        clientAuthOptions = clientOptions.auth;
        return client;
      }
    },
    addEventListener(type, handler) {
      windowEvents.set(type, handler);
    },
    dispatchEvent() {}
  };
  const context = {
    window,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    navigator: { get onLine() { return online; } },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    AbortController,
    console: { warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Math,
    Date,
    Map,
    crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return fetchHandler(url, options, requests.length);
    }
  };

  vm.runInNewContext(source, context, { filename: 'leaderboard.js' });
  return {
    leaderboard: window.Leaderboard,
    requests,
    storage,
    clientCount: () => clientCount,
    signInCount: () => signInCount,
    clientAuthOptions: () => clientAuthOptions,
    setOnline(value) { online = value; }
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('initialization creates one client and one anonymous identity', async () => {
  const harness = createHarness(() => jsonResponse({ data: [] }));
  await Promise.all([harness.leaderboard.init(), harness.leaderboard.init()]);

  assert.equal(harness.clientCount(), 1);
  assert.equal(harness.signInCount(), 1);
  assert.equal(harness.storage.get('lb_player_id'), 'anonymous-user');
  assert.equal(harness.clientAuthOptions().persistSession, true);
  assert.equal(harness.clientAuthOptions().autoRefreshToken, true);
});

test('saved anonymous session restores the same local player ID without signing in again', async () => {
  const session = { user: { id: 'persisted-anonymous-user' }, access_token: 'restored-access-token' };
  const harness = createHarness(() => jsonResponse({ data: [] }), { session });
  await harness.leaderboard.init();

  assert.equal(harness.signInCount(), 0);
  assert.equal(harness.leaderboard.getPlayerId(), 'persisted-anonymous-user');
});

test('display name is saved locally only when valid', () => {
  const harness = createHarness(() => jsonResponse({ data: [] }));

  assert.equal(harness.leaderboard.setDisplayName('Player One'), true);
  assert.equal(harness.storage.get('lb_display_name'), 'Player One');
  assert.equal(harness.leaderboard.setDisplayName('<invalid>'), false);
  assert.equal(harness.storage.get('lb_display_name'), 'Player One');
});

test('submission sends the user token, public key, and caller run ID', async () => {
  const harness = createHarness((url) => jsonResponse(url.endsWith('/submit-score')
    ? { success: true, data: {} }
    : { data: [] }));
  await harness.leaderboard.init();
  const runId = '11111111-1111-4111-8111-111111111111';
  const result = await harness.leaderboard.submitRun(12, runId);
  const request = harness.requests.find((entry) => entry.url.endsWith('/submit-score'));

  assert.equal(result.success, true);
  assert.equal(request.options.headers.apikey, 'sb_publishable_test-key');
  assert.equal(request.options.headers.Authorization, 'Bearer user-access-token');
  assert.equal(JSON.parse(request.options.body).run_id, runId);
});

test('transient submission failures retry at most three times with the same run ID', async () => {
  const harness = createHarness((url, options, requestNumber) => {
    if (url.endsWith('/submit-score') && requestNumber < 4) {
      return jsonResponse({ error: 'temporary' }, 503);
    }
    return jsonResponse(url.endsWith('/submit-score') ? { success: true } : { data: [] });
  });
  await harness.leaderboard.init();
  const runId = '33333333-3333-4333-8333-333333333333';
  const result = await harness.leaderboard.submitRun(8, runId);
  const submissions = harness.requests.filter((entry) => entry.url.endsWith('/submit-score'));

  assert.equal(result.success, true);
  assert.equal(submissions.length, 3);
  assert.deepEqual(submissions.map((entry) => JSON.parse(entry.options.body).run_id), [runId, runId, runId]);
});

test('permanent retry exhaustion stops after three attempts and removes the queued run', async () => {
  const harness = createHarness((url) => jsonResponse(url.endsWith('/submit-score')
    ? { error: 'temporary' }
    : { data: [] }, url.endsWith('/submit-score') ? 503 : 200));
  await harness.leaderboard.init();
  const runId = '55555555-5555-4555-8555-555555555555';
  const result = await harness.leaderboard.submitRun(5, runId);
  const submissions = harness.requests.filter((entry) => entry.url.endsWith('/submit-score'));

  assert.equal(result.status, 503);
  assert.equal(submissions.length, 3);
  assert.equal(JSON.parse(harness.storage.get('lb_pending_runs')).length, 0);
});

test('offline runs persist in a queue capped at ten entries', async () => {
  const harness = createHarness(() => jsonResponse({ data: [] }));
  await harness.leaderboard.init();
  harness.setOnline(false);

  for (let index = 0; index < 10; index++) {
    const runId = `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`;
    const result = await harness.leaderboard.submitRun(index, runId);
    assert.equal(result.offline, true);
  }
  const overflow = await harness.leaderboard.submitRun(10, 'aaaaaaaa-1111-4111-8111-111111111111');

  assert.match(overflow.error, /queue is full/i);
  assert.equal(JSON.parse(harness.storage.get('lb_pending_runs')).length, 10);
  assert.equal(harness.requests.filter((entry) => entry.url.endsWith('/submit-score')).length, 0);
});

test('auth failure does not discard the pending run or consume retry attempts', async () => {
  const harness = createHarness(() => jsonResponse({ data: [] }), { signInFailure: true });
  await harness.leaderboard.init();
  const runId = '44444444-4444-4444-8444-444444444444';
  const result = await harness.leaderboard.submitRun(4, runId);
  const pending = JSON.parse(harness.storage.get('lb_pending_runs'));

  assert.match(result.error, /authentication is unavailable/i);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].run_id, runId);
  assert.equal(pending[0].attempts, 0);
});

test('SQL and Edge Function use a unique player/run key for idempotency', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase/sql/01_schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/sql/03_run_idempotency.sql'), 'utf8');
  const handler = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/submit-score/index.ts'), 'utf8');

  assert.match(schema, /UNIQUE\s*\(player_id,\s*run_id\)/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS run_id UUID/i);
  assert.match(migration, /UNIQUE \(player_id, run_id\)/i);
  assert.match(handler, /onConflict:\s*"player_id,run_id"/);
  assert.match(handler, /ignoreDuplicates:\s*true/);
});

test('public read and authenticated submit have explicit gateway/CORS policies', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'supabase/config.toml'), 'utf8');
  const readHandler = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/get-top10/index.ts'), 'utf8');
  const submitHandler = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/submit-score/index.ts'), 'utf8');

  assert.match(config, /\[functions\.get-top10\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.submit-score\]\s+verify_jwt = true/);
  for (const handler of [readHandler, submitHandler]) {
    assert.match(handler, /"Access-Control-Allow-Origin": "\*"/);
    assert.match(handler, /headers: \{ \.\.\.corsHeaders, "Content-Type": "application\/json" \}/);
    assert.match(handler, /req\.method === "OPTIONS"/);
  }
});

test('page exposes visible controls for opening the leaderboard and saving a display name', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /<button id="lb-open"[^>]*>Leaderboard<\/button>/);
  assert.match(html, /id="lb-name-input"/);
  assert.match(html, /id="lb-save-name"/);
  assert.match(html, /id="lb-table-body"/);
});