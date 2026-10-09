# 🐦 Flappy Bird Clone with Live Leaderboard

A simple yet fun **Flappy Bird clone** built with **HTML, CSS, and Vanilla JavaScript (Canvas API)**. The project recreates the nostalgic gameplay of the original Flappy Bird, complete with physics, animations, sound effects, and score tracking. A hosted **Supabase backend** provides a live global leaderboard with anonymous auth, Realtime updates, and Edge Function-based score submissions.

🔗 **Live Demo**: [Flappy Bird](https://navidmirsoleimani.github.io/flappy-bird-js)

---

## 🚀 Features

* 🎮 **Core Gameplay**: Tap (or press space) to flap and avoid pipes.
* 🖼️ **Sprite-based Graphics**: Background, ground, pipes, bird animations, and game screens rendered from a single sprite sheet.
* 🐦 **Bird Physics**:
  * Gravity and jump mechanics.
  * Smooth rotation based on bird's movement (upward tilt when flapping, downward tilt when falling).
  * Animated wing flapping.
* 🛑 **Game States**:
  * **Get Ready** screen.
  * **Playing** mode.
  * **Game Over** screen.
* 🎶 **Sound Effects**:
  * Flap
  * Score
  * Collision hit
  * Die
  * Game start
* 🏆 **Scoring System**:
  * Score increases when passing pipes.
  * Best score stored in **localStorage** so it persists across sessions.
* 🌍 **Live Leaderboard** (Supabase):
  * One global all-time leaderboard sorted by score (descending) then earliest submission.
  * Anonymous sign-in provides a stable player ID on that browser/device.
  * Short display name saved with each submitted score.
  * Realtime updates while the leaderboard is open; manual refresh and 25-second polling fallback.
  * Final run submissions use a bounded local queue (up to 10 runs) and at most 3 attempts per run. Retryable failures reuse the same run ID; permanent failures are shown and discarded.
* 🏗️ **Canvas Rendering Loop**: Efficient rendering with `requestAnimationFrame`.
* 🌍 **Responsive Controls**: Playable with mouse clicks or **Spacebar** key; mobile-sized leaderboard overlay.

---

## 🛠️ Tech Stack

* **HTML5** – Structure & canvas setup.
* **CSS3** – Responsive styling with mobile-safe touch targets.
* **JavaScript (Vanilla)** – Game logic, physics, state management, animations, rendering, and leaderboard module.
* **Canvas API** – Drawing graphics and handling frame updates.
* **Supabase** (Postgres + Anonymous Auth + Edge Functions + Realtime) – Hosted backend for the leaderboard.

---

## 🎮 How to Play

1. Open the game in your browser.
2. Click anywhere on the screen or press **Spacebar** to flap.
3. Avoid the green pipes by flying through the gaps.
4. Score increases each time you pass a pipe.
5. If you hit a pipe or the ground → **Game Over**.
6. After game over, your score is submitted automatically (if configured). You can open the leaderboard (**L** key) to see the top 10.

---

## 🏗️ Setup and Deployment

### 1. Backend Foundation (Supabase)

1. Create a Supabase project and enable **Anonymous Sign-Ins** in **Authentication > Settings**.
2. For a new project, run `supabase/sql/01_schema.sql` and `supabase/sql/02_rls.sql` in the SQL Editor. For an existing table, also apply `supabase/sql/03_run_idempotency.sql` before deploying the updated submit function. This migration is not run automatically.
3. Confirm the Edge Function environment provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-only; never put it in the static site.
4. Link the CLI and deploy both functions. `supabase/config.toml` makes `get-top10` public at the gateway (the function still requires the project API key and reads through the public-read RLS policy) while `submit-score` requires a valid JWT.

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy get-top10 --use-api
npx supabase functions deploy submit-score --use-api
```

5. Enable `leaderboard_scores` in the `supabase_realtime` publication in the Supabase dashboard. SQL table creation does not enable Realtime automatically.

### 2. Client Configuration

The static browser app does not read `.env`. Set the project URL and public anon/publishable key in `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-public-key"
};
```

**Important**: Never include the service-role key in `config.js`, `index.html`, or `flappy.js`. It belongs only in Edge Function server configuration.

### 3. Running Locally

No package manager is required. Serve the files with any static server:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`. The public key is expected to be visible in browser code; never place a service-role or secret key there.

---

## 🔒 Privacy Notice

Only the anonymous player ID, your chosen display name, score, and submission timestamp are collected for rankings. No email, password, or personally identifying data is required. You can change or remove entries by contacting the site administrator; the leaderboard data is stored in a Postgres table protected by Row Level Security.

---

## ⚙️ Implementation Details (From IMPLEMENTATION_PLAN.md)

### Data and API
- `leaderboard_scores` table: `id`, `player_id`, `display_name`, `score`, `created_at`, `run_id`.
- Indexes for descending score + earliest submission time.
- RLS: deny direct client writes; allow public reads.
- Edge Function (`submit-score`) validates the authenticated player, integer score, display name, and UUID run ID. A unique `(player_id, run_id)` constraint and atomic upsert provide idempotency.
- Read query (`get-top10`) returns the top 10 with deterministic tie ordering.
- Realtime subscription and 25-second polling are active only while the leaderboard is open; polling is the fallback when Realtime is unavailable.

### Game Integration
- `finishRun()` is called once per run transition to game over (floor, ceiling, and pipe collisions), never per frame or per score increment.
- `localStorage` best score is preserved. Failed final submissions are kept in a queue of at most 10 runs and retried at most 3 times per run; the same UUID is reused across retries and page reloads.
- Game remains fully playable without network or configured backend.

### Abuse and Privacy
- Client-side validation is not cheat-proof. The Edge Function enforces score bounds (0–999), name length limits, character restrictions, and a per-player count-based rate limit. The count check is not atomic under concurrent submissions and is only a casual-abuse deterrent.
- If competitive integrity requires stronger guarantees, run simulation should be moved to a trusted server; the current design is appropriate for casual public leaderboards.

---

## 📋 Verification and Rollout

Test the following before production rollout:
- Two independent browsers/devices see submitted scores via Realtime after the table is added to the Realtime publication.
- Without Realtime, scores appear within the polling interval (≤ 25 seconds) while the leaderboard is open.
- One completed run creates at most one leaderboard entry after the idempotency migration has been applied.
- Invalid scores, oversized/invalid names, rate-limited submissions, and direct table writes are rejected.
- No privileged service-role key is present in the repository or browser bundle (`grep -r "service_role" .` should not find keys in source files).
- Leaderboard remains readable on desktop and mobile, including loading, empty, success, error, and offline states.
- Keyboard access: `Space` to play, `L` to open leaderboard, `Escape` to close.

Run the local regression tests with `npm test`. The tests mock the browser/Supabase boundary; they do not verify deployed functions, database constraints, or dashboard settings.

---

## 📸 Screenshots

### Get Ready

<img width="321" height="480" alt="Screenshot 2025-09-07 142450" src="https://github.com/user-attachments/assets/a5769ca3-153c-4c96-b091-1728c2cffe6b" />

### Gameplay

<img width="329" height="481" alt="Screenshot 2025-09-07 142517" src="https://github.com/user-attachments/assets/dbd0b061-eaf2-4494-ada8-f25067e90975" />

### Game Over

<img width="326" height="485" alt="Screenshot 2025-09-07 142530" src="https://github.com/user-attachments/assets/0115eb1c-1c14-488c-ad37-e956871682ac" />

### Leaderboard Overlay

A responsive overlay appears with the top 10 global scores, display name setup, refresh, and submission status.

---

## 🔮 Decisions Confirmed

* **Global all-time board** is sufficient for this MVP (no daily/weekly boards required at launch).
* **Anonymous accounts** are acceptable; persistent accounts are not required.
* **Casual abuse resistance** (score bounds, rate limits, name validation) is acceptable for launch; strong anti-cheat is not a launch requirement.

---

## 📄 License

See [LICENSE](LICENSE) for details.
