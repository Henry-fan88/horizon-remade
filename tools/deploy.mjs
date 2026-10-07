// Build and deploy to Cloudflare with one build id shared by the page and the worlds, so
// players on a page from an older deploy are asked to reload instead of joining a world
// whose map may differ.   npm run deploy [-- extra wrangler args]
import { execFileSync } from 'node:child_process';

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const sha = git('rev-parse', '--short', 'HEAD') || 'nogit';
const dirty = git('status', '--porcelain') ? '-dirty' : '';
const id = `${sha}${dirty}-${Date.now().toString(36)}`;
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log(`\n  Building ${id}\n`);
run('npx', ['vite', 'build'], { BUILD_ID: id });
run('npx', ['wrangler', 'deploy', '--var', `BUILD_ID:${id}`, ...process.argv.slice(2)]);
