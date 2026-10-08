-- Enable Row Level Security
ALTER TABLE public.leaderboard_scores ENABLE ROW LEVEL SECURITY;

-- Deny direct client inserts/updates/deletes
CREATE POLICY "Deny direct client writes" ON public.leaderboard_scores
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Permit public read of leaderboard rows only
CREATE POLICY "Public leaderboard read" ON public.leaderboard_scores
  FOR SELECT
  TO public
  USING (true);
