# Contributing

Horizon Remade is a community alpha. Bug reports, documentation, new events, better
driving behaviour, performance improvements and properly licensed assets are welcome.

## Get started

1. Fork the repository and clone your fork, or download it to try the game locally.
2. Use Node.js 22.12+ in the 22.x series (`nvm use` selects the version in `.nvmrc`).
3. Run `npm ci`, then `npm run dev`.
4. Open the address printed by Vite, normally `http://localhost:5173`.
5. Make a branch for your change. The primary branch is currently `master`.

See the [player guide](docs/PLAYING.md), [development guide](docs/DEVELOPMENT.md)
and [hosting guide](docs/HOSTING.md). You do not need a Cloudflare account to develop
the game or test multiplayer locally.

## Useful first contributions

| Change | Starting point |
| --- | --- |
| Explain a confusing control or improve a menu label | `docs/PLAYING.md`, `src/ui/menus.js` |
| Add a race route or stunt | `src/game/events.js`, `src/game/stunts.js` |
| Tune a car and measure the result | `src/vehicle/carspecs.js`, `tools/physbench.mjs` |
| Improve engine sound | `src/core/engine-profiles.js`, `tools/enginebench.mjs` |
| Add scenery or a scenic destination | `src/world/district-props.js`, `src/world/scenic-spots.js` |
| Improve AI drivers or multiplayer | `src/game/ai.js`, `src/net/`, `server/` |

For larger changes such as a track editor, a new physics model or a network protocol
change, describe the intended behaviour in an issue first so contributors can agree
on the approach. Small fixes can go straight to a pull request.

## Before opening a pull request

```bash
npm test
npm run build
git diff --check
```

Tests use Node's built-in test runner. Multiplayer tests open temporary localhost
sockets; they need an environment that permits listening on `127.0.0.1`.

Keep the change focused and follow the surrounding JavaScript style. Explain the
problem, the resulting behaviour, and what you checked. Add a regression test when
fixing game logic. For visual, handling or audio changes, also try the affected part
in the browser and include a screenshot, recording or short description of the result.
For multiplayer changes, use two clients and check joining, leaving and reconnecting.
Passing Node tests alone does not verify rendering, sound or driving feel.

The GitHub workflow runs the test suite and production build on pushes and pull
requests. It does not deploy the game.

## Report a bug

Include the browser and version, operating system, graphics setting, keyboard or
controller, car, location/event, weather, solo/online mode, reproduction steps, and
what you expected. A screenshot or console error is helpful. Avoid attaching private
chat messages, credentials or unrelated personal information.

## Assets and licensing

Original code and documentation contributions use the project's [MIT license](LICENSE).
Third-party assets keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

For a new model, texture, font or recording, include its creator, original source URL,
license, permission to redistribute, and a description of your changes. Keep the
required notices with the asset and update the credits. Do not add ripped game assets
or files with unclear redistribution rights. The car preparation workflow is in
[`tools/car-assets/README.md`](tools/car-assets/README.md).

Keep dependencies and their lockfile in sync. When changing runtime dependencies,
refresh the corresponding notices in `public/licenses/`; those files ship with the
website. Keep `public/licenses/horizon-remade.txt` in sync with the root `LICENSE`.
Do not commit build output, `node_modules`, credentials or local `.env` files.

Be constructive and respectful. Discuss the change and its evidence, and leave room
for other contributors to learn.
