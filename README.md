# 🐦 Flappy Bird Clone

A simple yet fun **Flappy Bird clone** built with **HTML, CSS, and Vanilla JavaScript (Canvas API)**.
The project recreates the nostalgic gameplay of the original Flappy Bird, complete with physics, animations, sound effects, and score tracking.

🔗 **Live Demo**: [Flappy Bird](https://navidmirsoleimani.github.io/flappy-bird-js)

---

## 🚀 Features

* 🎮 **Core Gameplay**: Tap (or press space) to flap and avoid pipes.
* 🖼️ **Sprite-based Graphics**: Background, ground, pipes, bird animations, and game screens rendered from a single sprite sheet.
* 🐦 **Bird Physics**:

  * Gravity and jump mechanics.
  * Smooth rotation based on bird’s movement (upward tilt when flapping, downward tilt when falling).
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
* 🏗️ **Canvas Rendering Loop**: Efficient rendering with `requestAnimationFrame`.
* 🌍 **Responsive Controls**: Playable with mouse clicks or **Spacebar** key.

---

## 🛠️ Tech Stack

* **HTML5** – Structure & canvas setup.
* **CSS3** – Basic styling.
* **JavaScript (Vanilla)** – Game logic, physics, state management, animations, and rendering.
* **Canvas API** – Drawing graphics and handling frame updates.

---

## 🎮 How to Play

1. Open the game in your browser.
2. Click anywhere on the screen or press **Spacebar** to flap.
3. Avoid the green pipes by flying through the gaps.
4. Score increases each time you pass a pipe.
5. If you hit a pipe or the ground → **Game Over**.

---

## 📸 Screenshots

### Get Ready

<img width="321" height="480" alt="Screenshot 2025-09-07 142450" src="https://github.com/user-attachments/assets/a5769ca3-153c-4c96-b091-1728c2cffe6b" />


### Gameplay

<img width="329" height="481" alt="Screenshot 2025-09-07 142517" src="https://github.com/user-attachments/assets/dbd0b061-eaf2-4494-ada8-f25067e90975" />


### Game Over

<img width="326" height="485" alt="Screenshot 2025-09-07 142530" src="https://github.com/user-attachments/assets/0115eb1c-1c14-488c-ad37-e956871682ac" />


---

## 🔮 Possible Improvements

* Add difficulty levels (narrower gaps, faster pipes).
* Implement medals (bronze, silver, gold) based on score.
* Add mobile touch optimization.
* Include background music.

