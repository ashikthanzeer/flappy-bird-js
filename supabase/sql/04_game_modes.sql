-- Apply once to existing projects before deploying mode-aware leaderboard functions.
ALTER TABLE public.leaderboard_scores
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'classic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leaderboard_scores_mode_check'
      AND conrelid = 'public.leaderboard_scores'::regclass
  ) THEN
    ALTER TABLE public.leaderboard_scores
      ADD CONSTRAINT leaderboard_scores_mode_check
      CHECK (mode IN ('classic', 'chaos'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leaderboard_scores_mode_score_created
  ON public.leaderboard_scores (mode, score DESC, created_at ASC);
