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
  * Realtime updates for new top-10 entries; manual refresh and 25-second polling fallback.
  * Offline-safe play: final run submission is queued/retried with duplicate protection.
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

1. Create a Supabase project.
2. In **SQL Editor**, run the schema and RLS scripts:
   - `supabase/sql/01_schema.sql`
   - `supabase/sql/02_rls.sql`
3. Enable **Anonymous Auth** in **Authentication > Settings**.
4. Deploy Edge Functions (`submit-score` and `get-top10`) using the Supabase CLI or dashboard.
5. Add environment variables in `.env.example` or deploy config:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (used only in Edge Functions, never in browser code)

### 2. Client Configuration

Copy `.env.example` to `.env` or edit `config.js` with your project URL and public anon key:

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

Then open `http://localhost:8080`.

---

## 🔒 Privacy Notice

Only the anonymous player ID, your chosen display name, score, and submission timestamp are collected for rankings. No email, password, or personally identifying data is required. You can change or remove entries by contacting the site administrator; the leaderboard data is stored in a Postgres table protected by Row Level Security.

---

## ⚙️ Implementation Details (From IMPLEMENTATION_PLAN.md)

### Data and API
- `leaderboard_scores` table: `id`, `player_id`, `display_name`, `score`, `created_at`.
- Indexes for descending score + earliest submission time.
- RLS: deny direct client writes; allow public reads.
- Edge Function (`submit-score`) validates score, display name, rate limits, and applies duplicate protection (`run_id`).
- Read query (`get-top10`) returns the top 10 with deterministic tie ordering.
- Realtime subscription enabled; unsubscribe when leaderboard hidden; polling every 25s as fallback.

### Game Integration
- `finishRun()` is called once per run transition to game over (floor, ceiling, and pipe collisions), never per frame or per score increment.
- `localStorage` best score preserved. Duplicate protection uses a run ID.
- Game remains fully playable without network or configured backend.

### Abuse and Privacy
- Client-side validation is not cheat-proof. The Edge Function enforces score bounds (0–999), name length limits, character restrictions, and rate limits.
- If competitive integrity requires stronger guarantees, run simulation should be moved to a trusted server; the current design is appropriate for casual public leaderboards.

---

## 📋 Verification and Rollout

Test the following before production rollout:
- Two independent browsers/devices see submitted scores via Realtime.
- Without Realtime, scores appear within the polling interval (≤ 30 seconds).
- One completed run creates at most one leaderboard entry, even after retries.
- Invalid scores, oversized/invalid names, rate-limited submissions, and direct table writes are rejected.
- No privileged service-role key is present in the repository or browser bundle (`grep -r "service_role" .` should not find keys in source files).
- Leaderboard remains readable on desktop and mobile, including loading, empty, success, error, and offline states.
- Keyboard access: `Space` to play, `L` to open leaderboard, `Escape` to close.

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
