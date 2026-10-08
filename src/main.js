import './styles/main.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';

import { Game } from './game/game.js';
import { EMBED, installEmbed } from './ui/embed.js';

const TIPS = [
  'Chain skills together — drifts, near misses, air and speed — to build a multiplier.',
  'Hold R to rewind time after a mistake.',
  'Press M to open the map and set a GPS route to any event.',
  'Smash the orange bonus boards hidden around the island for XP.',
  'Speed traps, drift zones and danger signs record your best scores.',
  'Hold Space for the handbrake to kick the rear out into a drift.',
  'Every level up earns a Wheelspin. Spin it in the Festival menu.',
  'Play online: other festival-goers appear on your map and in the world.',
];

const loading = document.getElementById('loading');
const fill = loading.querySelector('.load-fill');
const msg = loading.querySelector('.load-msg');
const tip = loading.querySelector('.load-tip');
tip.innerHTML = `<b>TIP</b>${TIPS[Math.floor(Math.random() * TIPS.length)]}`;

function supportsWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  if (!supportsWebGL2()) {
    msg.innerHTML = '<div class="load-error">Your browser does not support WebGL2, which this game needs. Try the latest Chrome, Edge, Firefox or Safari.</div>';
    return;
  }
  const game = new Game();
  try {
    await document.fonts.ready;
    await game.start((p, m) => {
      fill.style.width = `${Math.round(p * 100)}%`;
      if (m) msg.textContent = m;
    });
    fill.style.width = '100%';
    if (EMBED) installEmbed(game);
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('capture')) {
      const { installCapture } = await import('./dev/capture.js');
      installCapture(game);
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('environment')) {
      const { inspectEnvironment } = await import('./dev/environment-inspector.js');
      inspectEnvironment(game);
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('traffic')) {
      const { inspectTraffic } = await import('./dev/traffic-inspector.js');
      inspectTraffic(game);
    }
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 1200);
  } catch (err) {
    console.error(err);
    msg.innerHTML = `<div class="load-error">Something went wrong while loading:<br>${String(err.message || err)}</div>`;
  }
}

boot();
