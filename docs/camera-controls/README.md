# Drag look in every camera

Drag the game canvas with the left mouse button in any driving view. Press **C** to
cycle through **Chase**, **Far Chase**, **Hood**, **Bumper** and **Cockpit**.
Horizontal drag wraps through a full 360 degrees in all five modes.

Chase views orbit around the car, keeping it in frame and preserving the normal
follow distance. Vertical drag raises or lowers the orbit, with limits that keep the
camera upright and above terrain and water. Hood, Bumper and Cockpit rotate from
their normal camera mounts; vertical look stops at 85 degrees up or down.
The camera continues following the car while looking around.

Three seconds after the last drag movement, it eases back to the normal driving view
over 0.75 seconds, gently starting and ending the return. Moving again immediately
resumes control. The normal follow camera keeps updating underneath the orbit, so
the return follows the car's current location and heading.

Canvas pointer capture keeps a drag active outside its original bounds. Keyboard
driving continues while looking around. Pause,
the world map, camera changes, car resets and losing window focus clear the drag.

Verified on 2026-10-01:

- Twelve camera tests cover all five modes on all seven cars, a continuous
  360-degree sweep, car framing, moving vehicles, ground clearance, pitch limits,
  exact idle timing, smooth recentering, slow frames, pointer capture and mode changes.
- Seventy stationary and moving camera poses match the pre-change baseline exactly
  when the player has not dragged the camera.
- Native browser dragging in the Ferrari SF23 worked in all five cameras. Chase
  completed a full orbit; Chase, Hood, Bumper and Cockpit returned after idle.
  Switching cameras cleared the angle, and map and pause controls disabled drag-look.
- All 40 camera, environment, sand and snow tests and the production build pass.
- Browser console has no warnings or errors during these interactions.

Actual game captures: [Chase looking around the car](chase-orbit.jpg) and
[Chase after the idle return](chase-returned.jpg). Earlier captures show
[looking across the cockpit](cockpit-look.jpg) and
[the cockpit after the idle return](cockpit-returned.jpg).

The game now targets laptop and desktop browsers. Phone driving controls, rotation
prompts and the legacy `?touch` mode have been removed. A 1280-by-720 browser check
confirmed the normal minimap and gauges, keyboard camera switching, mouse drag-look
and idle return. The controls dialog opens at the top and scrolls within the window.
See the [laptop gameplay capture](laptop-gameplay.jpg).

Run automated checks with:

```sh
node --test tools/camera.test.mjs tools/environment.test.mjs tools/desert-visuals.test.mjs tools/snow.test.mjs
npm run build
```
