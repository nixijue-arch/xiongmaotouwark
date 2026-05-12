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
    eraseBand: meanRadius + 12,
    edgeThr: 253,
    // master 控 pre-blur: master<40 不 blur (保细五官), master 50 → 1px (mild),
    // master 100 → 5px (强 blur 抹 wrinkles). 细眉毛/嘴 typically 1-3px wide, σ<2 不破.
    preBlurR: Math.max(0, Math.round((m - 0.4) * 8)),
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
//   blackPoint 72, whitePoint 182, gamma 0.80, contrast 40, trimDark 65, trimThr 72
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

// trimDark: emulates the same step from processFace before L2-v4 runs.
// This is the SUSPECTED culprit of the residual contour line — it reduces alpha
// on polygon-interior lum<trimThr pixels (esp. near the edge), leaving them
// at alpha < 200 which v4 main loop later SKIPS. Their RGB stays at the
// pre-trimDark dark value → renders as a semi-transparent dark ring.
function applyTrimDark(rgba, w, h, trimDark = 65, trimThr = 72) {
  if (trimDark <= 0) return;
  const N = w * h;
  const alphaIn = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) alphaIn[i] = rgba[i * 4 + 3] > 200 ? 255 : 0;
  const blurred = boxBlur1D(alphaIn, w, h, 25);
  const strength = trimDark / 100;
  for (let i = 0; i < N; i++) {
    const di = i * 4;
    if (rgba[di + 3] < 200) continue;
    const lum = 0.299 * rgba[di] + 0.587 * rgba[di + 1] + 0.114 * rgba[di + 2];
    if (lum >= trimThr) continue;
    const edgeProx = blurred[i] / 255;
    if (edgeProx > 0.92) continue;
    const proxFactor = Math.max(0, 1 - edgeProx / 0.92);
    const darkFactor = 1 - lum / trimThr;
    const fade = strength * proxFactor * darkFactor;
    rgba[di + 3] = Math.round(rgba[di + 3] * (1 - fade));
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

  // 0. v4g: master-controlled pre-blur (抹平 wrinkles / skin texture noise)
  // 3-pass boxBlur1D ≈ Gaussian. radius = master/100 * 5. master=50 → r=3.
  // 只 blur RGB, alpha 不动. 也只对 polygon 内做 (用 padded average避免 edge bleed).
  if (eff.preBlurR > 0) {
    // 用 polygon mask weighted average 防 leak (polygon 外参与 mean 计算会拉低 face 边缘 lum)
    let sumR = 0, sumG = 0, sumB = 0, cn = 0;
    for (let i = 0; i < N; i++) {
      if (rgba[i * 4 + 3] > 200) {
        sumR += rgba[i * 4]; sumG += rgba[i * 4 + 1]; sumB += rgba[i * 4 + 2]; cn++;
      }
    }
    if (cn > 0) {
      const avgR = Math.round(sumR / cn);
      const avgG = Math.round(sumG / cn);
      const avgB = Math.round(sumB / cn);
      const Rs = new Uint8ClampedArray(N);
      const Gs = new Uint8ClampedArray(N);
      const Bs = new Uint8ClampedArray(N);
      for (let i = 0; i < N; i++) {
        if (rgba[i * 4 + 3] > 200) {
          Rs[i] = rgba[i * 4]; Gs[i] = rgba[i * 4 + 1]; Bs[i] = rgba[i * 4 + 2];
        } else {
          Rs[i] = avgR; Gs[i] = avgG; Bs[i] = avgB; // padding
        }
      }
      let Rb = boxBlur1D(Rs, w, h, eff.preBlurR);
      let Gb = boxBlur1D(Gs, w, h, eff.preBlurR);
      let Bb = boxBlur1D(Bs, w, h, eff.preBlurR);
      Rb = boxBlur1D(Rb, w, h, eff.preBlurR);
      Gb = boxBlur1D(Gb, w, h, eff.preBlurR);
      Bb = boxBlur1D(Bb, w, h, eff.preBlurR);
      Rb = boxBlur1D(Rb, w, h, eff.preBlurR);
      Gb = boxBlur1D(Gb, w, h, eff.preBlurR);
      Bb = boxBlur1D(Bb, w, h, eff.preBlurR);
      for (let i = 0; i < N; i++) {
        if (rgba[i * 4 + 3] > 200) {
          rgba[i * 4] = Rb[i]; rgba[i * 4 + 1] = Gb[i]; rgba[i * 4 + 2] = Bb[i];
        }
      }
    }
  }

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

  const W = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) W[i] = rgba[i * 4 + 3] >= 200 ? 255 : 0;
  const edgeDist = chamferDT(W, w, h);
  const eraseDistance = eff.eraseBand;
  const fadeDist = 80;
  const alphaFeatherR = 5;
  const eraseLum = 50;

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

    // v4g 修1: 头发渗入透明仅限 polygon 最外圈 12px (之前 125px 误杀内部五官!)
    const hairEraseR = 12;
    if (dist < hairEraseR && lum < eraseLum) {
      rgba[di + 3] = 0; continue;
    }

    // adaptive output (always compute)
    const mean = meanG[i];
    let diff = mean - lum;
    if (diff < -128) diff = -128;
    else if (diff > 127) diff = 127;
    const target = sigLut[(diff + 128) | 0];
    const adaptiveLum = (blend * target + (1 - blend) * lum) | 0;

    // alpha feather (5px 软渐变)
    let finalAlpha;
    if (dist < alphaFeatherR) {
      const t = dist / alphaFeatherR;
      finalAlpha = ((t * t * (3 - 2 * t)) * 255) | 0;
    } else finalAlpha = 255;

    // v4g 修2: 深色五官像素 (lum<60) 永远走纯 adaptive, 不被 erase blend lighten 成 mid-gray
    // adaptive 对深色像素 lum<60 + mean=150 输出接近 0 (纯黑) → 五官保持黑色
    if (lum < 60) {
      rgba[di] = adaptiveLum; rgba[di + 1] = adaptiveLum; rgba[di + 2] = adaptiveLum;
      rgba[di + 3] = finalAlpha;
      continue;
    }

    // 其他像素 (skin / shadow / texture): erase ↔ adaptive smoothstep blend
    let eraseW;
    if (dist < eraseDistance) eraseW = 1;
    else if (dist < eraseDistance + fadeDist) {
      const t = (dist - eraseDistance) / fadeDist;
      eraseW = 1 - t * t * (3 - 2 * t);
    } else eraseW = 0;
    const finalLum = (eraseW * 255 + (1 - eraseW) * adaptiveLum) | 0;
    rgba[di] = finalLum; rgba[di + 1] = finalLum; rgba[di + 2] = finalLum;
    rgba[di + 3] = finalAlpha;
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

// ROOT CAUSE 已确认: trimDark 在 purify>0 时 produces alpha-mid ring (v4 skip).
// Real app 已 fix: purify > 0 时 skip trimDark. Prototype mirror 同样逻辑.
const trimDarkActive = PURIFY === 0 && process.env.DISABLE_TRIMDARK !== '1';
if (trimDarkActive) applyTrimDark(rgba, w, h, 65, 72);

// L2-v4 main
const eff = deriveEffective(PURIFY);
console.log('eff =', eff, 'PURIFY =', PURIFY, 'trimDark =', trimDarkActive ? 'ON' : 'OFF (v4 enabled)');
applyL2(rgba, w, h, eff);
erodeThinBlackLines(rgba, w, h);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await square.write(OUTPUT);
console.log('wrote', OUTPUT);
