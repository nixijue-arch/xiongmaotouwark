// Offline prototype of the v4+ smart-extract pipeline against the user-supplied
// test image (image #13). Mirrors processFace pipeline so we can iterate on
// params without round-tripping through the browser.
//
// Usage: bun scripts/prototype-v4.mjs <inputPath> <outputPath> [purify]

import { Jimp } from 'jimp';
import { promises as fs } from 'fs';
import path from 'path';

const INPUT  = process.argv[2] || 'C:/Users/ROG/.claude/image-cache/b9733766-3ede-4690-aca5-07d8a3e62a50/13.jpeg';
const OUTPUT = process.argv[3] || 'D:/dev/xmw-fix/scripts/out-v4.png';
const PURIFY = Number(process.argv[4] ?? 50);

// =====================================================================
// Mirror of helpers in smartextractmodal.tsx
// =====================================================================
function boxBlur1D(src, w, h, r) {
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.max(0, Math.min(w - 1, x))];
    const div = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / div;
      const xR = Math.min(w - 1, x + r + 1), xL = Math.max(0, x - r);
      sum += src[y * w + xR] - src[y * w + xL];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    const div = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / div;
      const yD = Math.min(h - 1, y + r + 1), yU = Math.max(0, y - r);
      sum += tmp[yD * w + x] - tmp[yU * w + x];
    }
  }
  return out;
}

function deriveEffective(purify) {
  const m = Math.max(0, Math.min(100, purify)) / 100;
  const meanRadius = Math.max(15, Math.round(20 + m * 25));
  return {
    enabled: m > 0,
    adaptiveC: 12 + Math.round(m * 12),
    meanRadius,
    sharpness: Math.max(0.5, 4 - m * 3.5),
    blend: m,
    // eraseBand = meanRadius + 12: covers entire boundary-bias zone + healthy
    // safety margin. boxBlur1D(W, R) at distance X inside polygon gives
    // mean ≈ (X+R)/(2R+1) * 255, so edge zone reaches dist < R - small_eps.
    eraseBand: meanRadius + 12,
    edgeThr: 253,
  };
}

// =====================================================================
// Approximate clip-to-face-oval mask using a centered ellipse.
// In the real app this comes from mediapipe + Centripetal Catmull-Rom polygon,
// but for prototyping a smooth ellipse is good enough — the contour issue
// is the same shape topology.
// =====================================================================
function buildEllipseMask(w, h) {
  const cx = w / 2, cy = h / 2;
  const rx = w * 0.36;     // face width ≈ 72% of canvas
  const ry = h * 0.46;     // face height ≈ 92% (taller than wide)
  const W = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      W[y * w + x] = (nx * nx + ny * ny <= 1) ? 255 : 0;
    }
  }
  return W;
}

// Levels + contrast (matches high-key preset, restored to pre-upgrade values):
//   blackPoint 72, whitePoint 182, gamma 0.80, contrast 40
function applyLevelsContrast(rgba, w, h) {
  const bp = 72, wp = 182, gamma = 0.80, contrast = 40;
  const range = wp - bp;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = (i - bp) / range;
    v = Math.max(0, Math.min(1, v));
    v = Math.pow(v, 1 / gamma);
    lut[i] = Math.round(v * 255);
  }
  // levels
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue;
    rgba[i] = lut[rgba[i]]; rgba[i + 1] = lut[rgba[i + 1]]; rgba[i + 2] = lut[rgba[i + 2]];
  }
  // contrast
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const lut2 = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut2[i] = Math.max(0, Math.min(255, Math.round(factor * (i - 128) + 128)));
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue;
    rgba[i] = lut2[rgba[i]]; rgba[i + 1] = lut2[rgba[i + 1]]; rgba[i + 2] = lut2[rgba[i + 2]];
  }
}

// Chamfer Distance Transform — exact pixel distance from each polygon-inside
// pixel to the nearest edge. 2-pass O(N), much more accurate than boxBlur.
function chamferDT(W, w, h) {
  const dist = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < w * h; i++) dist[i] = W[i] > 0 ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (W[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - w] + 1);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + 1.41421356);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 1.41421356);
      }
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (W[i] === 0) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + 1);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 1.41421356);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + 1.41421356);
      }
      dist[i] = d;
    }
  }
  return dist;
}

// 1px black line erosion post-process: any black pixel (lum<25) whose 3x3
// neighborhood contains a non-dark pixel (lum>=180) is turned white. This
// kills residual polygon outline lines and isolated speckle without harming
// proper face features (which are wider than 1px and surrounded by black).
function erodeThinBlackLines(rgba, w, h) {
  const N = w * h;
  const lum = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    const di = i * 4;
    if (rgba[di + 3] < 200) { lum[i] = 255; continue; }
    lum[i] = (0.299 * rgba[di] + 0.587 * rgba[di + 1] + 0.114 * rgba[di + 2]) | 0;
  }
  const toWhite = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (lum[i] >= 25) continue;
      let hasLight = false;
      for (let dy = -1; dy <= 1 && !hasLight; dy++) {
        for (let dx = -1; dx <= 1 && !hasLight; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (lum[(y + dy) * w + (x + dx)] >= 180) hasLight = true;
        }
      }
      if (hasLight) toWhite[i] = 1;
    }
  }
  for (let i = 0; i < N; i++) {
    if (toWhite[i]) {
      const di = i * 4;
      rgba[di] = 255; rgba[di + 1] = 255; rgba[di + 2] = 255;
    }
  }
}

// L2-v4 algorithm proper
function applyL2(rgba, w, h, eff) {
  if (!eff.enabled) return;
  const N = w * h;
  // 1. luma map + face average
  const G = new Uint8ClampedArray(N);
  let sumLum = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    const di = i * 4;
    G[i] = (0.299 * rgba[di] + 0.587 * rgba[di + 1] + 0.114 * rgba[di + 2]) | 0;
    if (rgba[di + 3] > 200) { sumLum += G[i]; cnt++; }
  }
  if (cnt === 0) return;
  const faceAvg = Math.round(sumLum / cnt);

  // 2. padded luma
  const lumPad = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) lumPad[i] = rgba[i * 4 + 3] > 200 ? G[i] : faceAvg;
  const meanG = boxBlur1D(lumPad, w, h, eff.meanRadius);

  // 3. exact edge distance via Chamfer DT (much more accurate than boxBlur)
  const W = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) W[i] = rgba[i * 4 + 3] >= 200 ? 255 : 0;
  const edgeDist = chamferDT(W, w, h);
  const eraseDistance = eff.eraseBand;
  const extendedDistance = eraseDistance + 18;
  const eraseLum = 50;
  const extendedLumThr = 120;

  // 4. sigmoid LUT
  const sigLut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const diff = i - 128;
    const t = 1 / (1 + Math.exp(-(diff - eff.adaptiveC) / eff.sharpness));
    sigLut[i] = Math.round((1 - t) * 255);
  }

  const blend = eff.blend;
  for (let i = 0; i < N; i++) {
    const di = i * 4;
    if (rgba[di + 3] < 200) continue;
    const lum = G[i];
    const dist = edgeDist[i];
    if (dist < eraseDistance) {
      if (lum < eraseLum) { rgba[di + 3] = 0; }
      else { rgba[di] = 255; rgba[di + 1] = 255; rgba[di + 2] = 255; rgba[di + 3] = 255; }
      continue;
    }
    if (dist < extendedDistance && lum < extendedLumThr) {
      rgba[di] = 255; rgba[di + 1] = 255; rgba[di + 2] = 255; rgba[di + 3] = 255;
      continue;
    }
    const mean = meanG[i];
    let diff = mean - lum;
    if (diff < -128) diff = -128;
    else if (diff > 127) diff = 127;
    const target = sigLut[(diff + 128) | 0];
    const newL = (blend * target + (1 - blend) * lum) | 0;
    rgba[di] = newL; rgba[di + 1] = newL; rgba[di + 2] = newL;
  }
}

// =====================================================================
// Main: load image → fit to ellipse mask → run pipeline → write PNG
// =====================================================================
const img = await Jimp.read(INPUT);
// Resize to processFace canvas size (1024 square fit). For prototyping we use a
// square crop so the ellipse mask makes sense; in the real code the polygon is
// fit to 88% of the 1024 canvas.
const SIZE = 1024;
img.scaleToFit({ w: SIZE, h: SIZE });
// Pad to square
const square = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 });
square.composite(img, (SIZE - img.bitmap.width) >> 1, (SIZE - img.bitmap.height) >> 1);

const { bitmap } = square;
const w = bitmap.width, h = bitmap.height;
const rgba = bitmap.data; // Uint8Array

// Apply face mask (ellipse) — set alpha = 0 outside ellipse
const mask = buildEllipseMask(w, h);
for (let i = 0; i < w * h; i++) {
  if (mask[i] === 0) rgba[i * 4 + 3] = 0;
}

// alphaCut 200 (same as preset)
for (let i = 0; i < rgba.length; i += 4) {
  if (rgba[i + 3] < 200) rgba[i + 3] = 0;
}

// Levels + contrast
applyLevelsContrast(rgba, w, h);

// L2-v4 main
const eff = deriveEffective(PURIFY);
console.log('eff =', eff, 'PURIFY =', PURIFY);
applyL2(rgba, w, h, eff);
erodeThinBlackLines(rgba, w, h);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await square.write(OUTPUT);
console.log('wrote', OUTPUT);
