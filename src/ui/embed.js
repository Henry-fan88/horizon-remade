// Playing inside an X post. The page's player card (index.html, twitter:player) loads
// /?embed=1 in a frame of about 516 px square on desktop x.com. In that mode the HUD is
// laid out for a larger screen and scaled down to fit, and a cover asks for the click
// that gives the frame keyboard focus and unlocks audio. Corner buttons go fullscreen
// (allowed in X's frame) or open the full site in a new tab.
const UI_BASE = 820; // px of screen the HUD is laid out for before scaling

export const EMBED = new URLSearchParams(location.search).has('embed');

export function installEmbed(game) {
  document.body.classList.add('embed');
  const ui = document.getElementById('ui');
  const fit = () => ui.style.setProperty('--ui-scale', String(Math.min(1, Math.min(innerWidth, innerHeight) / UI_BASE)));
  fit();
  addEventListener('resize', fit);

  const root = document.createElement('div');
  root.className = 'embed-layer';
  root.innerHTML = `
    <div class="embed-cover on">
      <button class="embed-play">▶ CLICK TO DRIVE</button>
      <div class="embed-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive · drag to look around</div>
      <div class="embed-online"></div>
    </div>
    <div class="embed-tools">
      <button class="embed-full" title="Fullscreen">⛶</button>
      <a class="embed-open" href="./" target="_blank" rel="noopener" title="Open the full game in a new tab">↗</a>
    </div>
    <div class="embed-refocus">Click the game to keep driving</div>`;
  document.body.appendChild(root);
  const cover = root.querySelector('.embed-cover');
  const refocus = root.querySelector('.embed-refocus');
  const online = root.querySelector('.embed-online');

  // the click lands in this frame, so keys now come here and audio may start
  let started = false;
  cover.addEventListener('pointerdown', () => {
    started = true;
    cover.classList.remove('on');
    window.focus();
  });
  // clicking the post around the frame takes the keyboard away: say so
  addEventListener('blur', () => started && refocus.classList.add('on'));
  addEventListener('focus', () => refocus.classList.remove('on'));
  addEventListener('pointerdown', () => refocus.classList.remove('on'));

  root.querySelector('.embed-full').addEventListener('click', () => {
    const openTab = () => open('./', '_blank', 'noopener');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(openTab);
    else openTab();
  });

  setInterval(() => {
    const n = game.net;
    online.textContent = n.state === 'connected' ? `${n.players.size + 1} driving in World ${n.world} right now` : '';
  }, 1000);
}
