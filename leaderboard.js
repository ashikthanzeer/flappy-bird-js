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

  let supabase = null;
  let realtimeChannel = null;
  let pollTimer = null;

  let displayName = localStorage.getItem('lb_display_name') || '';
  let pendingSubmission = false;
  let submissionStatus = 'idle'; // idle | submitting | success | error | offline | duplicate
  let topTen = [];
  let lastRunId = '';

  // Helper: safe name validation (same rules as server)
  function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 20) return false;
    // Allow word chars, spaces, hyphen, underscore, dot
    if (/[^\w\s\-_.]/.test(trimmed) || /[<>]/.test(trimmed)) return false;
    return true;
  }

  function initClient() {
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return true;
    }
    return false;
  }

  async function signInAnonymous() {
    if (!supabase) return null;
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session) return session.user;

      const { data, error: signErr } = await supabase.auth.signInAnonymously();
      if (data && data.user) return data.user;
      // If anonymous auth not enabled, fall back to existing user id in storage
      const storedId = localStorage.getItem('lb_player_id');
      if (storedId) {
        return { id: storedId };
      }
      return null;
    } catch (e) {
      console.warn('Anonymous sign-in failed:', e);
      const storedId = localStorage.getItem('lb_player_id');
      return storedId ? { id: storedId } : null;
    }
  }

  async function fetchTopTen() {
    try {
      const res = await fetch(cfg.SUPABASE_URL ? cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/get-top10' : 'https://your-project.supabase.co/functions/v1/get-top10');
      const json = await res.json();
      if (json && Array.isArray(json.data)) {
        topTen = json.data;
        return topTen;
      }
    } catch (e) {
      console.warn('Fetch top 10 failed, falling back:', e);
    }
    return [];
  }

  async function submitScore(score, name) {
    if (pendingSubmission) return { error: 'Already submitting' };
    pendingSubmission = true;
    submissionStatus = 'submitting';

    const runId = lastRunId || (Date.now() + '-' + Math.random().toString(36).slice(2));
    lastRunId = runId;
    localStorage.setItem('lb_last_run_id', runId);

    try {
      const tokenRes = await supabase.auth.getSession();
      const token = tokenRes?.data?.session?.access_token || '';

      const endpoint = cfg.SUPABASE_URL ? cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/submit-score' : 'https://your-project.supabase.co/functions/v1/submit-score';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ score, display_name: name, run_id: runId })
      });
      const json = await res.json();
      if (!res.ok) {
        submissionStatus = 'error';
        return { error: json.error || 'Server error', status: res.status };
      }
      if (json.duplicate) {
        submissionStatus = 'duplicate';
        return { duplicate: true, data: json.data || {} };
      }
      submissionStatus = 'success';
      return { success: true, data: json.data || {} };
    } catch (e) {
      submissionStatus = 'offline';
      return { error: 'Network error', offline: true };
    } finally {
      pendingSubmission = false;
    }
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

  // Initialize
  function initLeaderboard() {
    initClient();
    signInAnonymous().then(user => {
      if (user && user.id) {
        localStorage.setItem('lb_player_id', user.id);
      }
    });
    fetchTopTen();
    subscribeRealtime();
    startPolling();
  }

  // Public API
  window.Leaderboard = {
    init: initLeaderboard,
    submitRun: async function (score) {
      const name = displayName || localStorage.getItem('lb_display_name') || 'Player';
      if (!isValidName(displayName) && displayName) {
        // Force a valid name if invalid
        return { error: 'Invalid display name' };
      }
      return submitScore(score, name || 'Player');
    },
    setDisplayName: function (name) {
      displayName = name ? name.trim() : '';
      localStorage.setItem('lb_display_name', displayName);
      return isValidName(displayName);
    },
    getDisplayName: function () { return displayName || localStorage.getItem('lb_display_name') || ''; },
    getStatus: function () { return submissionStatus; },
    getTopTen: function () { return topTen; },
    refresh: function () { fetchTopTen(); },
    unsubscribe: function () { unsubscribeRealtime(); },
    isOffline: function () { return !navigator.onLine; },
  };

  // Auto-init when config is present
  if (window.APP_CONFIG && SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'https://your-project.supabase.co') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initLeaderboard);
    } else {
      initLeaderboard();
    }
  } else {
    // Even without a configured backend, set up basic functions so the game works
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.Leaderboard = window.Leaderboard || {};
        window.Leaderboard.init = () => {};
        window.Leaderboard.submitRun = async () => ({ error: 'Not configured' });
        window.Leaderboard.setDisplayName = () => false;
        window.Leaderboard.getStatus = () => 'idle';
      });
    }
  }
})();
