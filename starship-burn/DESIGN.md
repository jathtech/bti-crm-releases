# Design notes

## The core loop

1. A **reference run**: an ideal flight computer flies the mission plan with no
   failures. Every step's gimbal command, throttle and attitude is recorded. Its
   path is "the line".
2. The **player's run** replays that recorded schedule open-loop with the
   scenario's failure injected, plus the player's timeline actions, plus a
   limited-authority SAS that tries to hold the *recorded* attitude with ±3° of
   gimbal. With no failure the replay reproduces the reference exactly
   (`tools/simcheck.js` asserts max deviation 0).
3. The first time a mission opens the player just watches it fail. Then they
   scrub back, add actions (throttle, engine on/off, gimbal trim, RCS pulse) and
   press play. The whole run is recomputed on every edit (~30 ms), so the
   timeline is a deterministic, instantly-replayable puzzle.

Why the player is the controller: a real vehicle's guidance would trim out a
single engine-out on its own, which makes no game. Here the recorded schedule is
the "flight software" and the SAS is deliberately limited, so an asymmetric
failure saturates it and the ship slowly diverges into a spin unless the player
re-trims, rebalances the engines or accepts a different trajectory.

## Physics (js/physics.js)

* 2-D rigid body in an inertial frame with a round Earth (inverse-square
  gravity). Downrange/altitude are polar coordinates, so the ascent mission has
  proper centrifugal relief and real osculating orbit elements at SECO.
* Six engines with the real hexagonal layout projected onto the trajectory
  plane: each engine's torque arm is `r·cos(azimuth)`. Centre engines gimbal
  together (±15°, 20°/s actuator); RVacs are fixed. Thrust = vacuum thrust −
  exit area × ambient pressure, constant mass flow.
* Mass properties move with propellant level (CoM, inertia), which is why the
  same trim behaves differently on a full ship at hot staging and an empty ship
  at landing.
* Engine states: off → spool (1.6 s) → on → shutdown (0.6 s) → off, plus failed.
  Relights use a hash of (scenario, engine, attempt) so outcomes are fixed per
  attempt: the hardware is what it is, but replays are honest.
* Aero (landing / hot stage): drag with a broadside/axial CdA blend, a
  destabilising moment toward broadside and rate damping. RCS is a nose
  thruster pair: torque plus a small lateral force, propellant cost at low Isp.
* Hazards: recovery % = f(rate error, attitude error vs plan); below 15 % for
  1 s the FTS fires. Structural failure above 5.5 g for 0.5 s. Recontact check
  against the booster interstage for the hot-stage mission. Propellant
  depletion kills all engines.

## The interesting bits the puzzles teach

* **Trim tilts the thrust.** Balancing an off-centre engine with gimbal makes
  the ship hold attitude but slide sideways (ascent: the vertical velocity and
  therefore the orbit; landing: horizontal drift). Trimming *past* the balance
  point makes the SAS lean the ship against the tilt and points thrust straight
  again. The landing mission needs ~6° trim on one engine for that reason.
* **Throttle compensates thrust, not torque.** Five engines at 100 % recover the
  planned acceleration after an RVac flameout, but the g-limit bites as mass
  drops, so the throttle has to be stepped down.
* **Shutting the opposite engine** restores symmetry with no trim, at the cost of
  a longer burn (gravity losses) or a longer separation.
* **Hover-slam is knife-edge by design.** On one engine the achievable net
  acceleration spans −3.6 to +5.6 m/s²; a 2 % throttle error over 12 s is a
  hard landing. The rewind tool makes the last-second flare a learnable skill.

## Tuning notes

* Reference plans are closed-loop (pitch programme with feed-forward, γ
  guidance on ascent, lean-to-null-velocity and a constant-deceleration profile
  on landing). Their outputs are what gets recorded, so they can be as clever as
  needed without touching the player-side rules.
* `tools/tune_*.js` were the sweeps used to pick the numbers; `tools/search.js`
  brute-forces example solutions. Each scenario stores one as `solution` for the
  harness and the "load an example fix" button.
* Scores: 0 stars = vehicle lost, 1 = intact but mission failed, 2 = mission
  achieved, 3 = achieved within tight terminal and RMS-deviation bounds.

## Adding a mission

Add an object to `SB.SCENARIOS` in `js/scenarios.js` with: `ship` overrides,
`initial` state (alt, speed, γ, pitch, engines on), `plan` (events, `pitch(t)`,
`throttle(...)`, optionally dynamic `ctx.cutoff([...])`), `failures`, `end()`,
`evaluate()`, `view` (`ascent` / `landing` / `stage`), `hints` and a
`solution`. Run `node tools/simcheck.js` until the reference is clean, the
failure fails and the solution succeeds. Ideas that fit the engine as-is:

* **Boostback / entry burn**: booster as the vehicle (needs a Super Heavy config).
* **Relight in space**: coast phase, RVac fails to relight, RCS-only attitude.
* **Two-engine landing with a late relight** or a stuck gimbal actuator
  (`gimbalMax` override per engine).
* **Hot stage variants**: booster residual thrust higher (recontact pressure),
  or a centre-engine no-light so the gimbal authority itself is reduced.
