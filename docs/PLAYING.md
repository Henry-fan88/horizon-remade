# How to play

[Back to the README](../README.md)

Horizon Remade is an open-world driving game for laptop and desktop browsers. You
can explore freely, race AI drivers, chase stunt records, or drive with other people
on the same server. There is no required order in which to complete events.

## Your first drive

1. Open the game in a browser with WebGL2 support. If running it yourself, follow
   the [quick start](../README.md#run-it-locally).
2. Wait for the island and cars to load, then press **Enter** or click the start
   button. Choose a driver name when prompted; online players can see this name.
3. Use **W / S** to accelerate or brake/reverse and **A / D** to steer. Automatic
   transmission and driving assists are enabled by default.
4. Press **M** for the world map. Select a race, location or scenic spot, then
   choose **SET ROUTE** to follow the GPS or **FAST TRAVEL** to jump there.
   Fast travelling to a race starts that event.
5. To start a race from the road, approach its glowing marker and press **Enter**.
   Choose **START RACE** or **RACE SOLO** for AI opponents. Follow the checkpoints
   in order; circuits require completing the displayed laps.
6. Press **Esc** for the festival menu. **MY CARS** lets you change your car;
   **EVENTS** lists races; **SETTINGS** contains graphics, driving and sound options.

If you get stuck, press **T** to return to the road. Hold **R** to rewind, then
release it to continue. Rewind is disabled during online races.

## Controls

Gamepad names below follow the standard Xbox-style browser mapping. Other
controllers may show different button labels. Press a button after connecting a
controller so the browser can detect it.

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Accelerate | W or Up arrow | RT |
| Brake / reverse | S or Down arrow | LT |
| Steer | A / D or Left / Right arrows | Left stick |
| Handbrake | Space | A |
| Rewind (hold; disabled in online races) | R | X |
| Reset car to road | T | Right-stick click |
| Cycle camera | C | Y |
| Look back (hold) | B | Left-stick click |
| Look around | Left mouse button + drag | — |
| Shift up / down (manual transmission) | E / Q | RB / LB |
| Start event / confirm | Enter | A |
| World map | M | View / Back |
| Festival menu | Esc or P | Menu / Start |
| Menu back | Esc or Backspace | B |
| Radio on / off | N | — |
| Horn | H | D-pad up |
| Lights | L | D-pad down |
| Join an online race / host starts early | J | — |
| Online chat | Y, then Enter to send; Esc to cancel | — |

The five camera views are Chase, Far Chase, Hood, Bumper and Cockpit. Drag to look
around in any view; the camera returns after about three seconds without dragging.
The game also has a controls screen under **Esc → FESTIVAL → CONTROLS**.

## Things to do

- **Race:** try circuits, sprints, dirt routes, the mountain pass and the Formula 1
  circuit. Brake before tight bends and accelerate as the steering straightens.
- **Explore:** use **M → Explore the island** to visit the city, dunes, forest,
  farmland, snow and wetlands. Gold camera markers lead to scenic viewpoints.
- **Build skill chains:** link drifts, jumps, speed and near misses. Crashes can
  break a chain, so leave room to recover.
- **Try PR stunts:** improve your stars and records at speed traps, speed zones,
  drift zones and danger-sign jumps.
- **Grow your garage:** earn credits and XP, use Wheelspins in the festival menu,
  and browse **AUTOSHOW**. The seven current playable cars are available in a new
  save; this alpha does not require unlocking the whole roster first.
- **Try a different climate:** open **Esc → SETTINGS** to choose weather, season
  and time of day. Wet roads and snow reduce grip; allow more braking distance.
  Automatic seasons last one real hour each and transition gradually.

Car performance is game tuning rather than a claim of manufacturer-accurate
simulation. There is no separate DRS or ERS simulation for the Formula 1 cars.

## Play with friends

Everyone needs to open the same hosted instance. The development server also
supports multiplayer: a second browser tab can join immediately, or another
computer on the same local network can use Vite's printed **Network** address.
`localhost` on a friend's computer refers to their computer, not yours.

Check **Esc → ONLINE** for connection status and the current world. New players
join world 1 until its configured capacity is reached, then overflow to another
world. Drivers in different worlds cannot see or race one another.

1. Approach a race marker, press **Enter**, and select **INVITE & RACE**. You can
   also create a lobby from the **ONLINE** tab.
2. Other drivers in your world receive an invitation and press **J** to join.
3. The lobby allows 20 seconds to join. The host can press **J** to start sooner,
   followed by the synchronized race countdown.
4. Everyone shares a grid and AI opponents. Players are ghosted against other
   cars in online races, and opening a menu does not pause the race.

Use **Y** for chat, or the chat box in **Esc → ONLINE**. To drive alone, choose
**GO OFFLINE** there. Time of day, weather and season changes affect everyone in
your world while connected; they are not personal settings in that mode.

Multiplayer is intended for casual play. Race progress is reported by clients;
there is no authoritative anti-cheat, account system, or persistent global ranking.

## Saving progress

Cars, credits, settings and records save automatically in this browser's
`localStorage`. There is no account or cloud save. A different browser, device,
site address or port has a separate save. Clearing site data or using a temporary
private-browsing session can discard progress.

**Esc → SETTINGS → Save data → RESET PROGRESS** deliberately wipes your local save.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Low frame rate | Set Graphics quality to Low/Medium, keep Dynamic resolution on, and turn off Traffic & pedestrians or Motion blur. |
| No sound | Click the game or press Enter to enable browser audio, then check the master and engine volume settings. |
| Keys do nothing | Click the game to focus it and close any active chat box. In an embedded view, use CLICK TO DRIVE. |
| Stuck or upside down | Press T; use R to rewind when outside an online race. |
| Blank screen / WebGL2 error | Check browser hardware acceleration and graphics support. Try another WebGL2-capable desktop browser. |
| Friends are missing | Check the same server and world number in ONLINE. Local network access may need a firewall permission. |
| Page asks to reload after an update | Reload so the page and multiplayer server use the same build. |

Touch driving controls are not implemented. For a reproducible bug, follow the
[bug-report guidance](../CONTRIBUTING.md#report-a-bug).
