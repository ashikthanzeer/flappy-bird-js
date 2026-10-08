// Submit score Edge Function
// Authenticates anonymous player, validates input, applies rate limits,
// and inserts using server-side credentials.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const MAX_SCORE = 999;
const MAX_NAME_LEN = 20;
const RATE_LIMIT_PER_PLAYER = 3; // submissions in 60 seconds
const RATE_LIMIT_WINDOW_SECS = 60;

serve(async (req) => {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    // Anonymous auth check using anon key is fine here for identity,
    // but the actual insert uses service role below.
    const anonSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonSupabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { score, display_name, run_id } = body;

    // Basic plausibility
    if (typeof score !== "number" || score < 0 || score > MAX_SCORE) {
      return new Response(JSON.stringify({ error: "Invalid score" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Name validation
    if (!display_name || typeof display_name !== "string") {
      return new Response(JSON.stringify({ error: "Display name required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const name = display_name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LEN) {
      return new Response(JSON.stringify({ error: "Invalid display name length" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    // Reject markup/control characters
    if (/[^\w\s\-_.]/.test(name) || /[<>]/.test(name)) {
      return new Response(JSON.stringify({ error: "Invalid characters in name" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const playerId = user.id;

    // Per-player rate limit: count recent submissions
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SECS * 1000).toISOString();
    const { count, error: rateErr } = await supabase
      .from("leaderboard_scores")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .gte("created_at", since);
    if (!rateErr && count !== null && count >= RATE_LIMIT_PER_PLAYER) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    // Duplicate protection: if run_id provided, check for existing row
    if (run_id && typeof run_id === "string") {
      const { data: dup } = await supabase
        .from("leaderboard_scores")
        .select("id")
        .eq("player_id", playerId)
        .eq("score", score)
        .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()) // 5 min window
        .limit(1);
      if (dup && dup.length > 0) {
        return new Response(JSON.stringify({ error: "Duplicate submission", duplicate: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    const { data, error: insertErr } = await supabase
      .from("leaderboard_scores")
      .insert({
        player_id: playerId,
        display_name: name,
        score,
      })
      .select();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, data: data?.[0] || {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Exception:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
