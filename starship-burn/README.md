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

Every control acts from the playhead onward. The rest of the flight is
re-simulated instantly (a full run takes ~30 ms) and drawn as a dotted line in
the flight view, so you see the consequence of a change before you press play.

* **Timeline** — drag to scrub; tap a chip to jump to that action.
* **Throttle** — all running engines, 40–100 %, or back to the plan's schedule.
  The readout shows engines, thrust and g-load at the playhead.
* **Engines** — shut down or relight any Raptor. Each button shows the engine's
  moment about the centre of mass, so a lone outboard engine is obviously the
  one rolling the ship. Relights roll dice (centre 85 %, RVac 70 %); a failed
  relight is permanent and the roll is fixed per attempt.
* **Gimbal** — a drag pad. Drag left or right to swivel the three centre engines
  (±10° of trim); the flame shows where they point and the nose swings the same
  way. Arcs around the CoM show the moment from the engine imbalance (red), from
  the gimbal (green) and what is left (white), with a marker at the trim that
  matches the imbalance. RECENTER zeroes the trim; MATCH THE IMBALANCE sets it.
  The stability system adds up to ±3° on top of your trim to hold the recorded
  attitude; **SAT** means it is out of authority.
* **RCS** — tap thrusters on the ship (nose and aft, port and starboard), pick
  power and burst length, and fire. The pad shows the burst's moment next to
  the engine imbalance, the rate change it will produce and the propellant it
  costs. A nose and an aft thruster on opposite sides make a pure couple.

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
tools/bundle.js     builds dist/index.html, a single self-contained file
tools/trace.js      prints a run's telemetry table (debugging / tuning)
```

`node tools/simcheck.js` must pass before committing physics or scenario changes.
See `DESIGN.md` for the model, the design decisions and how to add a mission.
