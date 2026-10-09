// Submit score Edge Function
// Authenticates anonymous player, validates input, applies rate limits,
// and inserts using server-side credentials.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body) ?? "null", {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const serverAuthOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const supabase = createClient(supabaseUrl, serviceRoleKey, serverAuthOptions);

const MAX_SCORE = 999;
const MAX_NAME_LEN = 20;
const RATE_LIMIT_PER_PLAYER = 3; // submissions in 60 seconds
const RATE_LIMIT_WINDOW_SECS = 60;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

    const anonSupabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      serverAuthOptions,
    );
    const { data: { user }, error: authErr } = await anonSupabase.auth.getUser(token);
    if (authErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }
    const { score, display_name, run_id } = body as Record<string, unknown>;

    if (typeof score !== "number" || !Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
      return jsonResponse({ error: "Invalid score" }, 400);
    }

    if (!display_name || typeof display_name !== "string") {
      return jsonResponse({ error: "Display name required" }, 400);
    }
    const name = display_name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LEN) {
      return jsonResponse({ error: "Invalid display name length" }, 400);
    }
    if (/[^\w\s\-_.]/.test(name) || /[<>]/.test(name)) {
      return jsonResponse({ error: "Invalid characters in name" }, 400);
    }
    if (typeof run_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run_id)) {
      return jsonResponse({ error: "Invalid run ID" }, 400);
    }

    const playerId = user.id;
    const { data: existingRun, error: duplicateCheckError } = await supabase
      .from("leaderboard_scores")
      .select("id, display_name, score, created_at")
      .eq("player_id", playerId)
      .eq("run_id", run_id)
      .maybeSingle();
    if (duplicateCheckError) {
      console.error("Duplicate check failed:", duplicateCheckError);
      return jsonResponse({ error: "Submission unavailable" }, 500);
    }
    if (existingRun) return jsonResponse({ success: true, duplicate: true, data: existingRun });

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SECS * 1000).toISOString();
    const { count, error: rateErr } = await supabase
      .from("leaderboard_scores")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .gte("created_at", since);
    if (rateErr || count === null) {
      console.error("Rate limit query failed:", rateErr);
      return jsonResponse({ error: "Submission unavailable" }, 500);
    }
    if (count >= RATE_LIMIT_PER_PLAYER) {
      return jsonResponse({ error: "Rate limited" }, 429);
    }

    const { data, error: insertErr } = await supabase
      .from("leaderboard_scores")
      .upsert({
        player_id: playerId,
        display_name: name,
        score,
        run_id,
      }, {
        onConflict: "player_id,run_id",
        ignoreDuplicates: true,
      })
      .select("id, display_name, score, created_at")
      .maybeSingle();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return jsonResponse({ error: "Server error" }, 500);
    }

    return jsonResponse({ success: true, duplicate: !data, data: data || {} });
  } catch (e) {
    console.error("Exception:", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
