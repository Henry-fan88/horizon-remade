// Development-only helpers for scripted screenshots from the browser pane, where the
// page's own animation frames may be throttled: step the game by hand and pose a
// free camera. Exposed on window when the URL has ?capture.
export function installCapture(game) {
  const g = game;
  // step the real game loop n frames at a fixed dt
  const run = (n = 60, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      g.last = performance.now() - dt * 1000;
      g.loop();
    }
    return g.frame;
  };
  // render inside animation frames so the compositor presents the result
  const frameShot = async (n = 2) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => (run(1), r())));
    await new Promise((r) => setTimeout(r, 60));
    return g.frame;
  };
  // free camera at (x,y,z) looking at (lx,ly,lz); the world streams around the target
  const view = async (x, y, z, lx, ly, lz, fov = 60, hideCar = true) => {
    g.state = 'environment-inspection';
    g.paused = true;
    g.hud.show(false);
    g.player.root.visible = !hideCar;
    const cam = g.camera;
    g.inspectionFocus = cam.position.clone().set(lx, ly, lz);
    for (let k = 0; k < 6; k++)
      await new Promise((r) =>
        requestAnimationFrame(() => {
          cam.position.set(x, y, z);
          cam.lookAt(lx, ly, lz);
          cam.fov = fov;
          cam.near = 0.3;
          cam.updateProjectionMatrix();
          run(1);
          r();
        })
      );
    await new Promise((r) => setTimeout(r, 60));
  };
  const drive = () => {
    g.state = 'freeroam';
    g.paused = false;
    g.hud.show(true);
    g.player.root.visible = true;
    g.inspectionFocus = null;
    g.gameCam.snap();
  };
  // put the player on a road (by name) at a fraction of its length
  const tp = (name, frac, back = 0) => {
    const r = g.world.network.roads.find((q) => q.name === name);
    const p = r.pointAt(r.length * frac, {});
    g.player.place(p.x - p.tx * back, p.z - p.tz * back, Math.atan2(p.tx, p.tz));
    g.gameCam.snap();
    return [Math.round(p.x), Math.round(p.z)];
  };
  Object.assign(window, { run, frameShot, view, drive, tp });
}
