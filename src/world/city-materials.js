// Materials for the San Francisco district. Facades are drawn procedurally on
// instanced boxes: every building gets a window grid fitted to its own walls
// (whole bays, whole floors), recessed reveals, sills, blinds and per-window
// night lighting, while the wall colour comes from the instance colour. A handful
// of shared materials therefore covers hundreds of differently painted buildings.
import * as THREE from 'three';
import { useFarShadow } from '../render/farshadow.js';

export const FACADE = { GLASS: 0, MASONRY: 1, BRICK: 2, SIDING: 3, RIBBON: 4 };

// Facade materials read the instance colour; keep them compiling without one.
const NO_COLOR = '#if !defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )\n const vec4 vColor = vec4(1.0);\n#endif';

const COMMON_GLSL = /* glsl */`
  float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
  }
  float fBand(float x, float a, float b, float aa) { return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x)); }
`;

// Facade coordinates: u across the wall (m), the wall's width, height above the
// box bottom (m) and the box height. Custom landmark geometry supplies its own
// mapping in a 'facade' attribute; plain boxes derive it from the instance scale.
const VERTEX_PARS = /* glsl */`
  attribute vec4 facade;
  varying vec4 vFacade;
  varying vec3 vFNormal;
  varying vec3 vFSeed;
  varying vec3 vFWorld;
`;
const VERTEX_MAIN = /* glsl */`
  vec3 fScale = vec3(1.0), fOrigin = vec3(0.0);
  #ifdef USE_INSTANCING
    fScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    fOrigin = instanceMatrix[3].xyz;
  #endif
  vFNormal = normal;
  vFSeed = fOrigin;
  if (facade.y > 0.0) {
    vFacade = facade;
  } else {
    bool sideFace = abs(normal.x) > abs(normal.z);
    float fw = sideFace ? fScale.z : fScale.x;
    vFacade = vec4((sideFace ? position.z * fScale.z : position.x * fScale.x) + fw * 0.5, fw, position.y * fScale.y + fScale.y * 0.5, fScale.y);
  }
  vec4 fWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fWorld = instanceMatrix * fWorld;
  #endif
  vFWorld = (modelMatrix * fWorld).xyz;
`;

function facadeFragment(kind, o) {
  const fh = o.floor.toFixed(2);
  return /* glsl */`
  vec3 wallCol = vColor.rgb;
  float u = vFacade.x, fw = max(vFacade.y, .5), y = vFacade.z, H = max(vFacade.w, .5);
  float bseed = fHash(floor(vFSeed.xz * .25) + .37);
  float bseed2 = fHash(floor(vFSeed.xz * .25) + 7.13);
  float px = max(fwidth(u), fwidth(y));
  float aa = px * .75 + .002;
  float far = smoothstep(.06, .45, px);
  bool roof = vFNormal.y > .5, under = vFNormal.y < -.5;
  float pane = 0.0, fRough = .86, fMetal = 0.0, lit = 0.0;
  vec3 litCol = mix(vec3(1.0, .7, .42), vec3(.82, .9, 1.0), step(.72, fHash(vFSeed.xz + 1.9)));
  vec3 col = wallCol;
  // weathering: soft vertical streaks and a darker plinth line
  col *= .93 + .1 * fNoise(vec2(u * 1.3, y * .06) + vFSeed.xz) - .05 * (1.0 - smoothstep(0.0, .7, y));
  ${kind === FACADE.BRICK ? /* glsl */`
    {
      vec2 bp = vec2(u / .225, y / .075);
      bp.x += .5 * mod(floor(bp.y), 2.0);
      vec2 bf = fract(bp);
      float mortar = 1.0 - fBand(bf.x, .045, .955, fwidth(bp.x)) * fBand(bf.y, .13, .87, fwidth(bp.y));
      vec3 brick = wallCol * (.78 + .38 * fHash(floor(bp) + floor(vFSeed.xz)));
      vec3 bricked = mix(brick, vec3(.6, .58, .54), mortar * .75);
      col *= mix(bricked / max(wallCol, vec3(.001)), vec3(.97), smoothstep(.015, .06, px));
    }` : ''}
  ${kind === FACADE.SIDING ? /* glsl */`
    col *= mix(.8 + .2 * smoothstep(.0, .3, fract(y / .17)), .94, smoothstep(.02, .07, px));` : ''}
  ${kind === FACADE.MASONRY ? /* glsl */`
    if (bseed2 > .55) {
      // dressed stone: staggered ashlar joints
      vec2 sp = vec2(u / 1.15 + .5 * mod(floor(y / .55), 2.0), y / .55);
      float joint = 1.0 - fBand(fract(sp.x), .02, .98, fwidth(sp.x)) * fBand(fract(sp.y), .04, .96, fwidth(sp.y));
      col *= 1.0 - joint * .16 * (1.0 - smoothstep(.02, .08, px));
      col *= .94 + .1 * fHash(floor(sp) + vFSeed.xz);
    }` : ''}
  ${kind === FACADE.GLASS ? /* glsl */`
    {
      float bayT = 1.5 + floor(bseed * 3.0) * .25;
      float nb = max(1.0, floor(fw / bayT + .5)), bw = fw / nb;
      float fh = ${fh} * (.96 + .08 * bseed2);
      float nf = max(1.0, floor((H - .6) / fh + .5)); fh = (H - .6) / nf;
      vec2 cell = vec2(u / bw, y / fh), id = floor(cell), f = fract(cell);
      float mull = .065 / bw;
      float spandrel = ${o.spandrel.toFixed(2)} * step(.35, bseed2);
      float glassMask = fBand(f.x, mull, 1.0 - mull, aa / bw) * fBand(f.y, spandrel + .02, .985, aa / fh) * step(y, H - .6);
      float v = fHash(id + floor(vFSeed.xz));
      vec3 glass = wallCol * (.72 + .38 * v);
      vec3 frame = mix(wallCol * .45, vec3(.78, .8, .8), ${o.lightFrames ? '1.0' : 'step(.6, bseed)'});
      vec3 spand = wallCol * .5 + .04;
      vec3 opaque = mix(frame, spand, fBand(f.y, .02, spandrel, aa / fh) * fBand(f.x, mull, 1.0 - mull, aa / bw));
      float avg = (1.0 - 2.0 * mull) * (1.0 - spandrel);
      pane = mix(glassMask, avg, far);
      col = mix(opaque, glass, pane);
      fRough = mix(.5, .03 + .14 * v, pane);
      fMetal = mix(.55, .9, pane);
      lit = glassMask * step(.58, fHash(id * 1.37 + vFSeed.xz)) * (.3 + .7 * v * v);
    }` : ''}
  ${kind === FACADE.RIBBON ? /* glsl */`
    {
      float fh = ${fh};
      float nf = max(1.0, floor((H - .5) / fh + .5)); fh = (H - .5) / nf;
      float pier = .8;
      float cy = y / fh, fy = fract(cy), idy = floor(cy);
      float band = fBand(fy, .34, .88, aa / fh) * fBand(u, pier, fw - pier, aa) * step(y, H - .5);
      float mullion = fBand(fract(u / 1.25), .03, .97, aa / 1.25);
      float v = fHash(vec2(floor(u / 1.25), idy) + vFSeed.xz);
      float blind = step(.45, v) * step(1.0 - (.25 + .5 * fHash(vec2(floor(u / 5.0), idy) + vFSeed.zx)), (fy - .34) / .54);
      vec3 glass = mix(vec3(.07, .085, .1), vec3(.62, .58, .5), blind * .8);
      pane = mix(band * mullion, .5, far);
      col = mix(col, glass, pane);
      fRough = mix(.85, mix(.06, .55, blind), pane);
      fMetal = mix(0.0, .6 * (1.0 - blind), pane);
      lit = band * mullion * step(.5, fHash(vec2(floor(u / 3.0), idy) + vFSeed.xz * 1.3));
    }` : ''}
  ${kind === FACADE.MASONRY || kind === FACADE.BRICK || kind === FACADE.SIDING ? /* glsl */`
    {
      bool front = vFNormal.z > .5;
      float bayT = ${kind === FACADE.BRICK ? 'mix(3.6, 4.4, bseed)' : kind === FACADE.SIDING ? '3.4' : o.bay ? o.bay.toFixed(2) : 'mix(2.6, 3.6, bseed)'};
      float pier = ${kind === FACADE.SIDING ? '1.0' : '.75'};
      float usable = fw - 2.0 * pier;
      float nb = max(1.0, floor(usable / bayT + .5)), bw = usable / nb;
      float cu = (u - pier) / bw, fx = fract(cu);
      float inside = step(0.0, cu) * step(cu, nb);
      float top = ${kind === FACADE.SIDING ? '.4' : '.9'};
      float fh = ${fh} * (.97 + .06 * bseed2);
      float nf = max(1.0, floor((H - top) / fh + .5)); fh = (H - top) / nf;
      float cy = y / fh, fy = fract(cy);
      vec2 id = vec2(floor(cu), floor(cy));
      float ww = ${kind === FACADE.BRICK ? '.66' : kind === FACADE.SIDING ? '.3' : 'mix(.4, .58, bseed2)'};
      float wh = ${kind === FACADE.BRICK ? '.62' : kind === FACADE.SIDING ? '.56' : 'mix(.5, .6, bseed)'};
      float y0 = .26, y1 = y0 + wh, x0 = .5 - ww * .5, x1 = .5 + ww * .5;
      float arch = ${kind === FACADE.BRICK ? 'step(.4, bseed2)' : kind === FACADE.MASONRY ? 'step(.8, bseed)' : '0.0'};
      // arched heads: round off the top corners
      float r = ww * bw * .5, ax = (fx - .5) * bw, ay = (fy - y1) * fh + r;
      float archCut = arch * step(0.0, ay) * smoothstep(r - aa, r + aa, length(vec2(ax, ay)));
      float win = fBand(fx, x0, x1, aa / bw) * fBand(fy, y0, y1, aa / fh) * inside * step(y, H - top) * (1.0 - archCut);
      ${kind === FACADE.SIDING ? 'win *= front ? 0.0 : step(.25, fHash(id + vFSeed.xz));' : ''}
      // recess shading from the head and one jamb; sill and lintel trim
      float dTop = (y1 - fy) * fh - archCut, dSide = (fx - x0) * bw;
      float recess = mix(.45, 1.0, smoothstep(.0, .2, dTop)) * mix(.7, 1.0, smoothstep(0.0, .12, dSide));
      float sill = fBand(fy, y0 - .055, y0 - .005, aa / fh) * fBand(fx, x0 - .04, x1 + .04, aa / bw) * inside * step(y, H - top);
      float lintel = fBand(fy, y1, y1 + .07, aa / fh) * fBand(fx, x0 - .02, x1 + .02, aa / bw) * inside * step(y, H - top) * (1.0 - arch);
      ${kind === FACADE.SIDING ? 'sill *= front ? 0.0 : 1.0; lintel *= front ? 0.0 : 1.0;' : ''}
      vec3 trim = ${kind === FACADE.SIDING ? 'mix(wallCol, vec3(.95, .93, .88), .75)' : kind === FACADE.BRICK ? 'vec3(.72, .68, .6)' : 'mix(wallCol, vec3(.9, .88, .82), .45)'};
      col = mix(col, trim, max(sill, lintel) * (1.0 - far));
      // glass: interiors, blinds and curtains differ per window
      float v = fHash(id + floor(vFSeed.xz)), v2 = fHash(id * 1.71 + vFSeed.zx);
      float wy = (fy - y0) / wh;
      float blind = step(.42, v) * step(1.0 - (.15 + .7 * v2), wy);
      vec3 shade = mix(vec3(.82, .76, .62), vec3(.55, .62, .66), step(.7, v2));
      vec3 glass = mix(vec3(.05, .06, .07) + .04 * v, shade * .7, blind) * recess;
      ${kind === FACADE.BRICK ? `
      float muntin = 1.0 - fBand(fract((fx - x0) / ww * 4.0), .06, .94, aa * 4.0 / (ww * bw)) * fBand(fract(wy * 3.0), .06, .94, aa * 3.0 / (wh * fh));
      glass = mix(glass, vec3(.12, .13, .12), muntin * (1.0 - far));` : ''}
      float avg = ww * wh * (nb * bw / fw) * .9;
      pane = mix(win, avg, far);
      col = mix(col, glass, pane);
      fRough = mix(fRough, mix(.07, .6, blind), pane);
      fMetal = mix(0.0, .55 * (1.0 - blind), pane);
      lit = win * step(${kind === FACADE.SIDING ? '.55' : '.62'}, v2) * (.25 + .75 * v * v);
    }` : ''}
  if (roof) {
    // tar-and-gravel or white membrane roofs
    float m = fHash(floor(vFSeed.xz * .25) + 3.3);
    col = mix(vec3(.36, .36, .35), vec3(.64, .63, .6), m) * (.82 + .3 * fNoise(vFWorld.xz * 1.7));
    col = mix(col, vec3(.78, .78, .76), step(.78, m));
    fRough = .93; fMetal = 0.0; pane = 0.0; lit = 0.0;
  }
  if (under) { col *= .4; lit = 0.0; }
  diffuseColor.rgb = col;
  vec3 fEmit = litCol * lit;
`;
}

function patchFacade(mat, kind, options) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vFacade; varying vec3 vFNormal; varying vec3 vFSeed; varying vec3 vFWorld;
        ${NO_COLOR}
        ${COMMON_GLSL}`)
      .replace('#include <color_fragment>', facadeFragment(kind, options))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= fEmit;');
  };
  mat.customProgramCacheKey = () => `sf-facade-${kind}-${options.floor}-${options.spandrel}-${options.lightFrames}-${options.bay}-v1`;
}

export function facade(props, kind, options = {}) {
  const o = { floor: 3.4, spandrel: .3, lightFrames: false, bay: 0, ...options };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.userData.bay = o.bay;
  patchFacade(mat, kind, o);
  props.nightMats.push({ mat, day: 0, night: kind === FACADE.GLASS ? .3 : .32 });
  return useFarShadow(mat);
}

// Glazing for modelled windows (bay windows, shopfronts): blinds, curtains and
// per-window night light, varied by each instance's position.
function windowGlass(props, { shop = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .08, metalness: shop ? .25 : .55, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWLocal; varying vec3 vWSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWLocal = position; vWSeed = vec3(0.0);
        #ifdef USE_INSTANCING
          vWSeed = instanceMatrix[3].xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWLocal; varying vec3 vWSeed;\n${NO_COLOR}\n${COMMON_GLSL}`)
      .replace('#include <color_fragment>', shop ? /* glsl */`
        float v = fHash(floor(vWSeed.xz * 2.0));
        float yy = vWLocal.y + .5;
        // shop interiors: lit ceiling, shelving and goods behind the glass
        vec3 inside = mix(vec3(.24, .2, .15), vec3(.16, .18, .2), step(.6, v));
        inside *= .75 + .5 * fNoise(vec2(vWLocal.x * 9.0 + v * 20.0, yy * 6.0));
        inside = mix(inside, vec3(.85, .8, .7), smoothstep(.86, .93, yy) * .6);
        diffuseColor.rgb = inside * vColor.rgb;
        vec3 fEmit = vec3(1.0, .82, .6) * (.35 + .4 * v) * smoothstep(.0, .3, yy);` : /* glsl */`
        float v = fHash(floor(vWSeed.xz * 3.0) + floor(vWSeed.y));
        float v2 = fHash(floor(vWSeed.xz * 3.0) + 4.7);
        float yy = vWLocal.y + .5;
        float blind = step(.4, v) * step(1.0 - (.15 + .65 * v2), yy);
        float curtain = step(.75, v2) * (smoothstep(.36, .4, abs(vWLocal.x)) );
        vec3 shade = mix(vec3(.85, .8, .68), vec3(.75, .5, .45), step(.85, v));
        diffuseColor.rgb = mix(vec3(.05, .06, .07) * vColor.rgb, shade * .75, max(blind, curtain));
        float lit = step(.52, v2);
        vec3 fEmit = mix(vec3(1.0, .76, .5), vec3(1.0, .88, .7), v) * lit * (1.0 - .6 * max(blind, curtain));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (shop ? '' : 'roughnessFactor = mix(roughnessFactor, .6, max(blind, curtain));'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= fEmit;');
  };
  mat.customProgramCacheKey = () => `sf-window-${shop}-v1`;
  props.nightMats.push({ mat, day: shop ? .1 : 0, night: shop ? .45 : .5 });
  return useFarShadow(mat);
}

// One texture holds every sign; the instance colour's red channel selects the cell.
export class SignAtlas {
  constructor(props, { cols = 2, rows = 64, cellW = 512, cellH = 64, vertical = false, alpha = false } = {}) {
    Object.assign(this, { cols, rows, cellW, cellH, vertical, entries: new Map(), count: 0 });
    this.canvas = document.createElement('canvas');
    this.canvas.width = cols * cellW; this.canvas.height = rows * cellH;
    this.ctx = this.canvas.getContext('2d');
    if (alpha) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.texture, roughness: .55, emissive: 0xffffff, emissiveIntensity: .1, alphaTest: alpha ? .5 : 0, side: THREE.FrontSide });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `
          float cellId = floor(vColor.r * 255.0 + .5);
          vec2 cell = vec2(mod(cellId, ${cols}.0), floor(cellId / ${cols}.0));
          vec2 suv = vec2((cell.x + clamp(vMapUv.x, .004, .996)) / ${cols}.0, 1.0 - (cell.y + 1.0 - clamp(vMapUv.y, .01, .99)) / ${rows}.0);
          vec4 signTexel = texture2D(map, suv);
          diffuseColor *= signTexel;`)
        .replace('#include <color_fragment>', '')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= signTexel.rgb * vColor.g;');
    };
    mat.customProgramCacheKey = () => `sf-signs-${cols}-${rows}-${alpha}`;
    props.nightMats.push({ mat, day: .12, night: 1.15 });
    this.material = mat;
  }
  // Returns the instance colour that selects this sign (green = glow strength).
  color(text, { bg = '#2b4a45', fg = '#f4e8cc', font = 'bold 40px "Barlow Condensed", sans-serif', glow = 1, draw = null } = {}) {
    const key = `${text}|${bg}|${fg}|${font}|${draw ? draw.name : ''}`;
    if (!this.entries.has(key)) {
      if (this.count >= this.cols * this.rows) console.warn(`[horizon] sign atlas full (${this.cols * this.rows}); reusing a cell for "${text}"`);
      const id = Math.min(this.count++, this.cols * this.rows - 1);
      const x = (id % this.cols) * this.cellW, y = Math.floor(id / this.cols) * this.cellH, g = this.ctx;
      g.save(); g.translate(x, y);
      g.beginPath(); g.rect(0, 0, this.cellW, this.cellH); g.clip();
      if (draw) draw(g, this.cellW, this.cellH, text);
      else {
        if (bg) { g.fillStyle = bg; g.fillRect(0, 0, this.cellW, this.cellH); }
        g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (this.vertical) {
          const chars = [...text], step = this.cellH / (chars.length + .4);
          g.font = font.replace(/\d+px/, `${Math.floor(Math.min(this.cellW * .82, step * .92))}px`);
          chars.forEach((c, i) => g.fillText(c, this.cellW / 2, step * (i + .7)));
        } else {
          let size = parseFloat(font.match(/(\d+)px/)?.[1] || 40);
          const fit = () => { g.font = font.replace(/\d+px/, `${size}px`); return g.measureText(text).width; };
          while (fit() > this.cellW * .9 && size > 12) size -= 2;
          g.fillText(text, this.cellW / 2, this.cellH / 2 + 2);
        }
      }
      g.restore();
      this.entries.set(key, id);
      this.texture.needsUpdate = true;
    }
    return new THREE.Color().setRGB(this.entries.get(key) / 255, glow, 1, THREE.LinearSRGBColorSpace);
  }
}

// Concrete sidewalk slabs scored every 1.5 m along the street; Market Street gets
// brick pavers. UVs are metres (u along the street, v across).
function pavingMaterial(brick, onRoad = false) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .92, vertexColors: true, polygonOffset: onRoad, polygonOffsetFactor: onRoad ? -2 : 0, polygonOffsetUnits: onRoad ? -3 : 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paveUv; varying vec2 vPave; varying vec3 vPaveWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vPave = paveUv; vPaveWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vPave; varying vec3 vPaveWorld;\n${COMMON_GLSL}`)
      .replace('#include <color_fragment>', brick ? /* glsl */`
        vec2 bp = vec2(vPave.x / .2, vPave.y / .1);
        bp.x += .5 * mod(floor(bp.y), 2.0);
        float px = fwidth(vPave.x);
        float joint = 1.0 - fBand(fract(bp.x), .06, .94, fwidth(bp.x)) * fBand(fract(bp.y), .1, .9, fwidth(bp.y));
        vec3 brick = vec3(.45, .22, .17) * (.78 + .34 * fHash(floor(bp)));
        vec3 pave = mix(brick, vec3(.5, .47, .43), joint * .7 * (1.0 - smoothstep(.01, .05, px)));
        float edge = step(vPave.y, .55);
        pave = mix(pave, vec3(.62, .62, .6) * (.9 + .2 * fNoise(vPave * 3.0)), edge);
        diffuseColor.rgb = pave * vColor.rgb;` : /* glsl */`
        vec2 sp = vec2(vPave.x / 1.5, vPave.y / 1.25);
        float px = fwidth(vPave.x);
        float joint = 1.0 - fBand(fract(sp.x), .012, .988, fwidth(sp.x)) * fBand(fract(sp.y), .015, .985, fwidth(sp.y));
        float slab = fHash(floor(sp) + floor(vPaveWorld.xz * .01));
        vec3 pave = vec3(.5, .49, .46) * (.88 + .14 * slab) * (.92 + .12 * fNoise(vPaveWorld.xz * 1.3));
        pave *= 1.0 - .12 * smoothstep(.5, .9, fNoise(vPaveWorld.xz * .35)) - .05 * smoothstep(.6, .95, fNoise(vPaveWorld.xz * 2.7));
        pave *= 1.0 - joint * .28 * (1.0 - smoothstep(.01, .05, px));
        diffuseColor.rgb = pave * vColor.rgb;`);
  };
  mat.customProgramCacheKey = () => `sf-paving-${brick}-${onRoad}`;
  return useFarShadow(mat);
}

// Ground-hugging surfaces in world space: back-yard lawns and granite plazas.
function groundMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGWorld;\n${COMMON_GLSL}`)
      .replace('#include <color_fragment>', kind === 'lawn' ? /* glsl */`
        float n = fNoise(vGWorld.xz * .35) * .6 + fNoise(vGWorld.xz * 2.1) * .4;
        vec3 g = mix(vec3(.2, .3, .12), vec3(.36, .42, .2), n);
        g = mix(g, vec3(.4, .36, .26), smoothstep(.72, .9, fNoise(vGWorld.xz * .9 + 4.0)) * .7);
        diffuseColor.rgb = g;` : /* glsl */`
        vec2 sp = vGWorld.xz / 1.6;
        float px = fwidth(sp.x);
        float joint = 1.0 - fBand(fract(sp.x), .02, .98, fwidth(sp.x)) * fBand(fract(sp.y), .02, .98, fwidth(sp.y));
        vec3 granite = vec3(.58, .565, .53) * (.86 + .18 * fHash(floor(sp))) * (.94 + .08 * fNoise(vGWorld.xz * 4.0));
        diffuseColor.rgb = granite * (1.0 - joint * .25 * (1.0 - smoothstep(.02, .1, px)));`);
  };
  mat.customProgramCacheKey = () => `sf-ground-${kind}`;
  return useFarShadow(mat);
}

function clockMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  g.strokeStyle = '#2e3633'; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.lineWidth = k % 3 ? 4 : 9; g.beginPath(); g.moveTo(Math.sin(a) * 92, -Math.cos(a) * 92); g.lineTo(Math.sin(a) * 110, -Math.cos(a) * 110); g.stroke(); }
  g.lineCap = 'round';
  for (const [a, l, w] of [[-1.1, 58, 9], [.55, 88, 6]]) { g.lineWidth = w; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * l, -Math.cos(a) * l); g.stroke(); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: .05, roughness: .6 });
}

export function makeCityMaterials(props) {
  const std = (o) => useFarShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, ...o }));
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .3, emissive: 0xffd9a0, emissiveIntensity: .2 });
  props.nightMats.push({ mat: lamp, day: .2, night: 7 });
  const clock = clockMaterial();
  props.nightMats.push({ mat: clock, day: .05, night: .9 });
  return {
    lamp, clock,
    glass: facade(props, FACADE.GLASS, { floor: 4.0, spandrel: .3 }),
    glassLight: facade(props, FACADE.GLASS, { floor: 4.2, spandrel: .12, lightFrames: true }),
    masonry: facade(props, FACADE.MASONRY, { floor: 3.5 }),
    masonryTall: facade(props, FACADE.MASONRY, { floor: 3.9 }),
    masonryGrid: facade(props, FACADE.MASONRY, { floor: 3.8, bay: 3.0 }),
    brick: facade(props, FACADE.BRICK, { floor: 4.1 }),
    siding: facade(props, FACADE.SIDING, { floor: 3.4 }),
    ribbon: facade(props, FACADE.RIBBON, { floor: 3.1 }),
    paint: std({ roughness: .72 }),
    stucco: std({ roughness: .9 }),
    metal: std({ roughness: .45, metalness: .45 }),
    chrome: std({ roughness: .22, metalness: .9 }),
    window: windowGlass(props),
    shop: windowGlass(props, { shop: true }),
    paving: pavingMaterial(false),
    brickPaving: pavingMaterial(true),
    roadBrick: pavingMaterial(true, true),
    lawn: groundMaterial('lawn'),
    granite: groundMaterial('granite'),
  };
}
