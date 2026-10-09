-- Apply once to existing projects before deploying the updated submit-score function.
ALTER TABLE public.leaderboard_scores
  ADD COLUMN IF NOT EXISTS run_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leaderboard_scores_player_run_id_key'
      AND conrelid = 'public.leaderboard_scores'::regclass
  ) THEN
    ALTER TABLE public.leaderboard_scores
      ADD CONSTRAINT leaderboard_scores_player_run_id_key
      UNIQUE (player_id, run_id);
  END IF;
END
$$;