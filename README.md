# POD RUN — Drift Circuit

A WebXR desert skiff racing game for Meta Quest (and desktop browsers).
Sit in a twin-thruster skiff, grab the yokes with your VR controllers, and feed
power independently to each thruster — differential thrust is your steering.

All names, places, and craft are original (skiffs, cages, thrusters, the
Rustmere Cut circuit, the Drift Circuit league).

## Play online (Quest)

After deploy: **https://smallerbytes.github.io/pod-run/**

Open that URL in the Quest browser → ENTER VR.

## Play locally

```bash
npm install
npm run dev
```

- **Desktop:** open the printed `https://localhost:5173` URL. Build your skiff
  in the brick garage, then RUN ON DESKTOP. Hold `Q` / `P` to push the left /
  right throttle, `A` / `D` to lean and steer, `Shift` for overdrive, mouse to
  look, `R` to rerun after finishing, `Esc` back to the garage.
- **Quest:** on the same Wi-Fi, open `https://<your-pc-lan-ip>:5173` in the
  Quest browser, accept the self-signed certificate, then press ENTER VR.
  - **Grip** near a T-bar throttle to grab it (left hand = left engine).
  - **Push the lever forward** for power, **pull back** to slow down.
  - **Lean your hands left / right** while gripping to steer — the skiff
    responds slowly and deliberately, like hauling a heavy machine around.
  - **A / X** while gripping = overdrive (drains the OD meter, spikes heat).

## Systems

- **Brick garage (LEGO-style):** snap kits into 9 slots — hull, seat, nose,
  left/right fins, left/right engines, left/right cables — plus
  primary/secondary/stripe paint and spec-sheet bars; persists to
  `localStorage`. The default build is a silver-and-blue teardrop pod with
  cable-hung twin engines.
- **Race:** 3 laps of Rustmere Cut vs 4 AI rivals with light rubber-banding
  (off on the final lap).
- **Dashboard (diegetic, no screen overlay):** speed, twin thrust bars,
  stability, hull, overdrive meter, place/lap/time, nav mini-map with rivals
  and next checkpoint.
- **Hazards:** canyon walls damage the hull; soft sand near the edges drags;
  overheating caps thruster power; a dead hull puts you in limp mode.

## Build

```bash
npm run build   # typecheck + production bundle in dist/
```
