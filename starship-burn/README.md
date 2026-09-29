# Burn Director — Starship engine-burn puzzles

A small mobile-first game about keeping Starship on its planned trajectory when an
engine burn goes wrong. It is not a fly-the-whole-launch game: each mission is one
short burn window and the plan flies itself until something breaks. You are the flight software: the plan flies itself until
something breaks, then you rewind, place corrections on the timeline and replay.

No build step, no dependencies. Open `index.html` in any modern browser
(phone or desktop), or serve the folder statically and add it to your home
screen (it ships a web-app manifest).

```
cd starship-burn
npx serve .          # or: python3 -m http.server 8080
```

## Missions

| # | Mission | What breaks | The fix (one of several) |
|---|---------|-------------|--------------------------|
| 1 | **Hot Stage** (tutorial, 25 s) | RVac 3 never lights; the ship rolls off after clamp release and the SAS runs out of authority | ~+4° gimbal trim right after separation, or shut down the opposite RVac |
| 2 | **RVac Out** (ascent to SECO, ~70 s) | RVac 3 flames out at T+12: less thrust, off-centre torque, thin Δv margin, 5.5 g structural limit | trim to balance, throttle the remaining five up, then step the throttle down as the tanks empty; hit the target orbit |
| 3 | **Tower Catch** (flip and hover-slam to the chopsticks, ~17 s) | centre engine C3 fails to ignite; the recorded flip and throttle schedule were computed for three engines | match the plan's thrust with two engines, trim the lopsided torque, then fly the single-engine hover-slam by hand so the catch pins stop dead at the arm rails |

Every mission is judged on the terminal state (handoff / orbit / catch),
deviation from the planned line, Δv margin and loads. Three stars need a clean
recovery; a spin below 15% recovery probability triggers the flight termination
system and the ship is lost.

## Controls

* **Timeline** — drag to scrub. Actions apply from the moment you place them; the
  whole flight is re-simulated instantly (a full run takes ~30 ms), so rewinding
  and retrying is free.
* **Throttle** — all running engines, 40–100 %, or back to the plan's schedule.
* **Engines** — shut down or relight any Raptor. Relights roll dice (centre 85 %,
  RVac 70 %); a failed relight is permanent and the roll is fixed per attempt, so
  the same timeline always replays the same way.
* **Gimbal** — trims the three centre engines. A stability-augmentation system
  adds up to ±3° on top to hold the recorded attitude; when it shows **SAT** it is
  out of authority and the ship starts to diverge.
* **RCS** — vents propellant sideways from the nose for a timed pulse of torque.

Space plays/pauses; ←/→ scrub by 0.5 s (shift: 5 s) on a keyboard.

## Layout

```
index.html          page shell
css/style.css       mobile-first layout (two columns above 900 px)
js/util.js          helpers, deterministic hash (relight rolls)
js/vehicle.js       Starship config, mass properties, engine model
js/physics.js       2-D rigid body around a round Earth, aero, orbit elements
js/controller.js    ideal flight computer (reference run) and the player's SAS
js/sim.js           runs a scenario: reference recording or player replay
js/scenarios.js     the three missions: plan, failure, end condition, scoring
js/render.js        scene canvas + engine-ring / attitude inset
js/main.js          app state, playback, timeline editor, cards
tools/simcheck.js   node harness: reference clean, failure fails, solution wins
tools/screenshot.js Playwright smoke test that walks the UI and saves screenshots
tools/trace.js      prints a run's telemetry table (debugging / tuning)
```

`node tools/simcheck.js` must pass before committing physics or scenario changes.
See `DESIGN.md` for the model, the design decisions and how to add a mission.
