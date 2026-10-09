/**
 * Leaderboard client service.
 * Keeps backend calls out of drawing/per-frame logic.
 * Uses Supabase anonymous auth + Edge Function for writes,
 * Realtime for live updates, and polling fallback.
 */

(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || '';
  const POLL_INTERVAL_MS = 25000;
  const MAX_PENDING_RUNS = 10;
  const MAX_ATTEMPTS = 3;
  const PENDING_RUNS_KEY = 'lb_pending_runs';

  let supabase = null;
  let realtimeChannel = null;
  let pollTimer = null;
  let displayName = localStorage.getItem('lb_display_name') || '';
  let submissionStatus = 'idle';
  let topTen = [];
  let initPromise = null;
  let processingPromise = null;
  let requestVersion = 0;
  let isVisible = false;
  const runResults = new Map();

  // Helper: safe name validation (same rules as server)
  function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 20) return false;
    // Allow word chars, spaces, hyphen, underscore, dot
    if (/[^\w\s\-_.]/.test(trimmed) || /[<>]/.test(trimmed)) return false;
    return true;
  }

  function publishChange(status, error) {
    window.dispatchEvent(new CustomEvent('leaderboard:change', {
      detail: { rows: topTen, status, error: error || '' }
    }));
  }

  function initClient() {
    if (supabase) return true;
    if (window.supabase?.createClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      return true;
    }
    return false;
  }

  async function signInAnonymous() {
    if (!supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session.user;

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      if (data && data.user) return data.user;
      throw new Error('Anonymous sign-in returned no user.');
    } catch (e) {
      console.warn('Anonymous sign-in failed:', e);
      throw e;
    }
  }

  function readPendingRuns() {
    try {
      const stored = JSON.parse(localStorage.getItem(PENDING_RUNS_KEY) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter((run) => run &&
        typeof run.run_id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run.run_id) &&
        Number.isSafeInteger(run.score) && run.score >= 0 && run.score <= 999 &&
        isValidName(run.display_name) &&
        Number.isInteger(run.attempts) && run.attempts >= 0 && run.attempts <= MAX_ATTEMPTS
      ).slice(0, MAX_PENDING_RUNS);
    } catch (e) {
      return [];
    }
  }

  function writePendingRuns(runs) {
    localStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(runs));
  }

  function removePendingRun(runId) {
    writePendingRuns(readPendingRuns().filter((run) => run.run_id !== runId));
  }

  function createRunId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      return (char === 'x' ? value : (value & 3 | 8)).toString(16);
    });
  }

  async function fetchTopTen() {
    const version = ++requestVersion;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      publishChange('error', 'Supabase configuration is missing.');
      return topTen;
    }

    publishChange('loading');
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/get-top10`, {
        method: 'GET',
        headers: { apikey: SUPABASE_ANON_KEY }
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || `HTTP ${response.status}`);
      if (!json || !Array.isArray(json.data)) throw new Error('Invalid leaderboard response.');
      if (version === requestVersion) {
        topTen = json.data;
        publishChange('success');
      }
      return topTen;
    } catch (error) {
      console.warn('Fetch top 10 failed:', error);
      if (version === requestVersion) publishChange('error', error.message || 'Leaderboard request failed.');
      return topTen;
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function processPendingRuns(runId) {
    if (!supabase) return runId ? { error: 'Leaderboard is not configured.' } : undefined;
    if (processingPromise) {
      await processingPromise;
      if (runId && readPendingRuns().some((run) => run.run_id === runId)) {
        return processPendingRuns(runId);
      }
      return runId ? runResults.get(runId) || { error: 'Submission could not be completed.' } : undefined;
    }

    processingPromise = (async () => {
      const results = {};
      for (const queuedRun of readPendingRuns()) {
        if (!navigator.onLine) {
          submissionStatus = 'offline';
          publishChange('offline', 'Waiting for a network connection.');
          results[queuedRun.run_id] = { error: 'Network unavailable', offline: true };
          break;
        }

        let result;
        let accessToken;
        try {
          let { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) {
            const user = await signInAnonymous();
            localStorage.setItem('lb_player_id', user.id);
            ({ data: { session } } = await supabase.auth.getSession());
          }
          if (!session?.access_token) throw new Error('Anonymous authentication is unavailable.');
          accessToken = session.access_token;
        } catch (error) {
          result = { error: 'Anonymous authentication is unavailable.' };
          runResults.set(queuedRun.run_id, result);
          publishChange('error', result.error);
          break;
        }

        while (queuedRun.attempts < MAX_ATTEMPTS) {
          queuedRun.attempts++;
          writePendingRuns(readPendingRuns().map((run) => run.run_id === queuedRun.run_id ? queuedRun : run));
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || accessToken;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            let response;
            try {
              response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/submit-score`, {
                method: 'POST',
                headers: {
                  apikey: SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  score: queuedRun.score,
                  display_name: queuedRun.display_name,
                  run_id: queuedRun.run_id
                }),
                signal: controller.signal
              });
            } finally {
              clearTimeout(timeout);
            }

            const json = await response.json().catch(() => null);
            if (response.ok && (json?.success || json?.duplicate)) {
              result = json.duplicate ? { duplicate: true } : { success: true };
              removePendingRun(queuedRun.run_id);
              submissionStatus = json.duplicate ? 'duplicate' : 'success';
              fetchTopTen();
              break;
            }

            const transient = response.status === 408 || response.status === 429 || response.status >= 500;
            if (transient && queuedRun.attempts < MAX_ATTEMPTS) {
              await delay(250 * (2 ** (queuedRun.attempts - 1)));
              continue;
            }
            result = { error: json?.error || `Submission failed (HTTP ${response.status}).`, status: response.status };
            removePendingRun(queuedRun.run_id);
            submissionStatus = 'error';
            break;
          } catch (error) {
            if (!navigator.onLine) {
              result = { error: 'Network unavailable', offline: true };
              submissionStatus = 'offline';
              break;
            }
            if (queuedRun.attempts < MAX_ATTEMPTS) {
              await delay(250 * (2 ** (queuedRun.attempts - 1)));
              continue;
            }
            result = { error: error.name === 'AbortError' ? 'Submission timed out.' : 'Network request failed.' };
            removePendingRun(queuedRun.run_id);
            submissionStatus = 'error';
          }
          break;
        }

        if (!result && queuedRun.attempts >= MAX_ATTEMPTS) {
          result = { error: 'Retry limit reached.' };
          removePendingRun(queuedRun.run_id);
          submissionStatus = 'error';
        }
        if (result) {
          results[queuedRun.run_id] = result;
          runResults.set(queuedRun.run_id, result);
          if (runResults.size > MAX_PENDING_RUNS) runResults.delete(runResults.keys().next().value);
        }
        publishChange(submissionStatus, result?.error || '');
        if (result?.offline) break;
      }
      if (!runId) return undefined;
      return results[runId] || runResults.get(runId) ||
        (!navigator.onLine && readPendingRuns().some((run) => run.run_id === runId)
          ? { error: 'Network unavailable', offline: true }
          : undefined);
    })();

    try {
      return await processingPromise;
    } finally {
      processingPromise = null;
    }
  }

  async function submitRun(score, runId) {
    if (!Number.isSafeInteger(score) || score < 0 || score > 999) return { error: 'Invalid score.' };
    const name = displayName || 'Player';
    if (!isValidName(name)) return { error: 'Invalid display name.' };
    runId = runId || createRunId();

    await initLeaderboard();
    if (!supabase) return { error: 'Leaderboard is not configured.' };

    const runs = readPendingRuns();
    const existing = runs.find((run) => run.run_id === runId);
    if (!existing) {
      if (runs.length >= MAX_PENDING_RUNS) return { error: 'Pending submission queue is full.' };
      runs.push({ run_id: runId, score, display_name: name, attempts: 0 });
      writePendingRuns(runs);
    }
    submissionStatus = 'submitting';
    publishChange('submitting');
    return processPendingRuns(runId);
  }

  function subscribeRealtime() {
    if (!supabase) return;
    if (realtimeChannel) {
      try { supabase.removeChannel(realtimeChannel); } catch (e) {}
      realtimeChannel = null;
    }
    try {
      realtimeChannel = supabase
        .channel('leaderboard_updates')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leaderboard_scores' }, (payload) => {
          // Refresh on any new row; we don't push individual rows directly to keep it simple
          fetchTopTen();
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscribe failed:', e);
    }
  }

  function unsubscribeRealtime() {
    if (realtimeChannel && supabase) {
      try { supabase.removeChannel(realtimeChannel); } catch (e) {}
      realtimeChannel = null;
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      fetchTopTen();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function setVisible(visible) {
    isVisible = visible && !!supabase;
    if (isVisible) {
      subscribeRealtime();
      startPolling();
    } else {
      unsubscribeRealtime();
      stopPolling();
    }
  }

  function initLeaderboard() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!initClient()) {
        publishChange('error', 'Leaderboard is not configured.');
        return false;
      }
      try {
        const user = await signInAnonymous();
        localStorage.setItem('lb_player_id', user.id);
        publishChange('identity');
      } catch (error) {
        publishChange('error', 'Anonymous sign-in failed.');
      }
      await fetchTopTen();
      if (readPendingRuns().length && navigator.onLine) processPendingRuns();
      return true;
    })();
    return initPromise;
  }

  // Public API
  window.Leaderboard = {
    init: initLeaderboard,
    submitRun,
    setDisplayName: function (name) {
      const normalizedName = name ? name.trim() : '';
      if (!isValidName(normalizedName)) return false;
      displayName = normalizedName;
      localStorage.setItem('lb_display_name', displayName);
      return true;
    },
    getDisplayName: function () { return displayName || localStorage.getItem('lb_display_name') || ''; },
    getPlayerId: function () { return localStorage.getItem('lb_player_id') || ''; },
    getStatus: function () { return submissionStatus; },
    getTopTen: function () { return topTen; },
    refresh: fetchTopTen,
    setVisible,
    unsubscribe: function () { unsubscribeRealtime(); },
    isOffline: function () { return !navigator.onLine; },
  };

  window.addEventListener('online', () => processPendingRuns());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLeaderboard, { once: true });
  else initLeaderboard();
})();
