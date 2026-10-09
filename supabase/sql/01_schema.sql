-- Leaderboard table for anonymous global scores
CREATE TABLE IF NOT EXISTS public.leaderboard_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id UUID NOT NULL,
  CONSTRAINT leaderboard_scores_player_run_id_key UNIQUE (player_id, run_id)
);

-- Indexes for descending score (tie: earliest submission) and time-based queries
CREATE INDEX IF NOT EXISTS idx_leaderboard_scores_score_created
  ON public.leaderboard_scores (score DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_leaderboard_scores_player
  ON public.leaderboard_scores (player_id);
