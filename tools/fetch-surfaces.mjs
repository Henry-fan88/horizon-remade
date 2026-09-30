// Download and bundle the CC0 Poly Haven surface maps the terrain and roads use.
//   node tools/fetch-surfaces.mjs
// Downloads the 1k JPEG diffuse / OpenGL normal / roughness / displacement maps, checks the
// source MD5, recompresses them with macOS `sips` (84 quality, normals 90) into
// public/environment/surfaces/ and records provenance in manifest.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

const OUT = 'public/environment/surfaces';
const TMP = '/tmp/horizon-surfaces';
mkdirSync(TMP, { recursive: true });

// id -> role in the game, real-world tile width (m), maps to fetch
const ASSETS = [
  ['aerial_grass_rock', 'grass', 15],
  ['dirt', 'dirt', 2],
  ['rock_face', 'rock', 2.4],
  ['asphalt_02', 'asphalt', 3],
  ['forrest_ground_01', 'forest', 2],
  ['dry_ground_rocks', 'dry', 4],
  ['sand_01', 'sand', 1.5],
  ['snow_02', 'snow', 2],
  ['gravel_road', 'gravel', 2],
  ['rock_boulder_dry', 'redrock', 1.8],
  ['aerial_asphalt_01', 'asphaltMacro', 30, ['Diffuse']],
];
const MAPS = { Diffuse: 'diff', nor_gl: 'nor_gl', Rough: 'rough', Displacement: 'disp' };

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const manifestPath = `${OUT}/manifest.json`;
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { license: 'CC0-1.0', licenseURL: 'https://polyhaven.com/license', assets: [] };
manifest.retrieved = new Date().toISOString().slice(0, 10);

for (const [id, role, tile, only] of ASSETS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  const prev = manifest.assets.find((a) => a.id === id);
  const entry = { id, role, author: prev?.author || Object.keys(info.authors || {}).join(', '), source: `https://polyhaven.com/a/${id}`, api: `https://api.polyhaven.com/files/${id}`, sourceTileMeters: tile, maps: [] };
  for (const [map, suffix] of Object.entries(MAPS)) {
    if (only && !only.includes(map)) continue;
    const src = files[map]?.['1k']?.jpg;
    if (!src) throw new Error(`${id}: no 1k jpg for ${map}`);
    const file = `${id}_${suffix}_1k.jpg`;
    // files bundled earlier from the same source stay byte-identical
    const kept = prev?.maps.find((m) => m.file === file && m.sourceMD5 === src.md5);
    if (kept && existsSync(`${OUT}/${file}`)) {
      entry.maps.push(kept);
      continue;
    }
    const tmp = `${TMP}/${file}`;
    const buf = Buffer.from(await (await fetch(src.url)).arrayBuffer());
    if (md5(buf) !== src.md5) throw new Error(`${id} ${map}: MD5 mismatch`);
    writeFileSync(tmp, buf);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', suffix === 'nor_gl' ? '90' : '84', tmp, '--out', `${OUT}/${file}`], { stdio: 'ignore' });
    const out = readFileSync(`${OUT}/${file}`);
    entry.maps.push({ map, file, sourceURL: src.url, sourceMD5: src.md5, sha256: sha256(out), bytes: statSync(`${OUT}/${file}`).size });
    console.log(`${file.padEnd(40)} ${(out.length / 1024).toFixed(0)} KB`);
  }
  const i = manifest.assets.findIndex((a) => a.id === id);
  if (i >= 0) manifest.assets[i] = entry;
  else manifest.assets.push(entry);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest updated:', manifest.assets.length, 'assets');
