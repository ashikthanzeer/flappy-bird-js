# Live Leaderboard Implementation Plan

## Current State
- The game is a static HTML/CSS/vanilla-JavaScript canvas app with no server or package manager.
- The current player's best score is stored in `localStorage`; score increments happen as pipes leave the screen.
- Game over is set in bird/pipe update logic, and the game-over screen is drawn on the canvas.
- The game is hosted as a static site, so shared rankings require a hosted backend.

## Recommended MVP
Use Supabase (Postgres, anonymous authentication, Edge Functions, and Realtime) so the game can stay statically hosted. Keep its public anon key in client configuration only; never put a service-role key in browser code. Route score writes through an Edge Function and restrict direct table writes with Row Level Security (RLS).

Default product assumptions:
- One global all-time leaderboard, sorted by score descending and then earliest submission.
- A player can play without creating an account; an anonymous account provides a stable player ID on that browser/device.
- Players choose a short display name. Store it with each submitted score so historical entries do not change if the name is later edited.
- “Live” means the top 10 updates automatically through Supabase Realtime, with a manual refresh and polling fallback if Realtime is unavailable.

## Data and API
1. Create a `leaderboard_scores` table with `id`, `player_id`, `display_name`, `score`, and server-generated `created_at` fields. Add indexes for descending score and submission time.
2. Enable anonymous sign-in. Validate and normalize display names, impose a character limit, and reject empty names or markup/control characters.
3. Enable RLS. Permit only the intended public leaderboard read; deny direct client inserts/updates/deletes. Never expose privileged credentials.
4. Add an Edge Function for submissions. It authenticates the anonymous player, validates the score and name, applies per-player rate limits and basic plausibility checks, and inserts the row using server-side credentials.
5. Add a read query or RPC that returns only the top 10 public entries, with deterministic tie ordering and no unnecessary identity data.
6. Enable Realtime for new score rows, or publish a constrained leaderboard update signal. Subscribe only while the leaderboard view is visible; unsubscribe when hidden. Fall back to polling every 20–30 seconds and provide a refresh action.

## Game Integration
1. Add a one-shot `finishRun` path that records the final score and updates local best exactly once on transition to game over. Call it from pipe, floor, and ceiling collision paths; do not submit on every score increment or animation frame.
2. Preserve local play if the network is unavailable. Queue or retry only the final run submission, with duplicate protection (for example, a run ID) so retries cannot create duplicate rows.
3. On game over, show the player's score and personal best, plus submission status. Add a separate leaderboard view or compact overlay rather than squeezing a full ranking into the existing sprite-based game-over panel.
4. Add an accessible display-name entry and leaderboard controls outside the canvas, styled to work at mobile sizes. Show clear loading, empty, success, offline, and error states; keep gameplay input responsive while requests run.
5. Preserve the current local best score and medal display. Do not require sign-in before playing.

## Abuse and Privacy
- A client-side game cannot prove that a submitted score was earned honestly. Server checks and rate limits deter casual abuse but are not cheat-proof.
- For a casual public leaderboard, enforce sane score bounds, per-player submission limits, and anomaly monitoring in the Edge Function.
- If strong competitive integrity becomes a requirement, move run simulation or verifiable score generation to a trusted server; do not imply that client-side validation alone prevents cheating.
- Publish a short privacy notice, collect only the anonymous player ID, display name, score, and timestamp needed for rankings, and provide a way to change or remove a player's entries.

## Delivery Phases
1. **Backend foundation:** create the Supabase project, schema, RLS policies, anonymous auth, Edge Function, and deployed environment configuration. Test rejected writes and invalid submissions as well as successful ones.
2. **Client service:** add a small leaderboard module for initialization, anonymous identity, top-10 fetch, score submission, Realtime subscription, and graceful fallback. Keep backend calls out of drawing and per-frame update functions.
3. **UI:** add the display-name setup and responsive leaderboard view; integrate one-time submission and status into game over; preserve offline play.
4. **Verification and rollout:** test two independent browsers/devices, simultaneous submissions, tie ordering, duplicate retries, offline recovery, denied direct writes, small screens, keyboard/touch access, and deployment against production settings. Document Supabase setup and environment configuration in the README.

## Acceptance Criteria
- A submitted run appears in the top 10 on another browser without a page reload when Realtime is available, and within the polling interval otherwise.
- One completed run creates at most one leaderboard entry, even after retries.
- The game remains playable without network access or a configured backend.
- Invalid scores, oversized/invalid names, rate-limited submissions, and direct client writes are rejected.
- No privileged backend key is present in the repository or browser bundle.
- Leaderboard content remains readable and operable on desktop and mobile, including loading, empty, and failure states.

## Decisions to Confirm Before Implementation
- Is one global all-time board sufficient, or are daily/weekly boards needed?
- Should players use anonymous names, or should persistent accounts be required?
- Is casual abuse resistance acceptable, or is strong anti-cheat a launch requirement?
