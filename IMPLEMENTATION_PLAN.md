# Kathikalle Umma - Flappy Bird: Customisation Plan

## Audit Results
- Canvas fixed at 320x480; no responsive scaling
- No touch/mobile events (click + spacebar only)
- Game difficulty too high: gravity 0.20, jump 4.6, gap 95, dx 2, random y range -150..0
- Medal sprites (silver, gold) present in sprite.png but unused
- Sounds intact; no audio modifications
- No badge/achievement display interface
- No CSS styling for mobile viewport

## Implementation Plan
1. Responsive Design & Device Optimisation
   - Dynamic canvas scaling based on viewport
   - CSS: 100vh/100vw, centered canvas, touch-action: none
   - Touch events: touchstart, touchmove prevention
2. Badge System (Medals from sprite)
   - Define medal coordinates from sprite.png (silver ~295,100; gold ~340,140)
   - Score thresholds: Bronze(5+), Silver(15+), Gold(30+), Platinum(50+)
   - Draw medal badge on Game Over screen next to best score
3. Difficulty & Performance Improvements
   - Gravity: 0.20 -> 0.18 (easier float)
   - Jump: 4.6 -> 5.5 (stronger lift)
   - Gap: 95 -> 120 (wider gap)
   - Pipe dx: 2 -> 1.8 (slightly slower)
   - Pipe y range: -150 -> -90 (less extreme)
   - Frame-rate consistency: cap update logic
4. Technical Performance
   - Add `will-change: transform` to canvas
   - Prevent default scroll on mobile
   - Efficient collision checks
5. No sound changes (preserve all audios/)
