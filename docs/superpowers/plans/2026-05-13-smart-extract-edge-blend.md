# 智能抠图边缘融合 + 拖锚点圆滑 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SmartExtractModal 的智能抠图与手动拖锚点升级 — 边缘可融、内部细节抹平、拖锚点不出尖刺 — 在不重构旧方案、3 个保底 preset 行为零变更的前提下完成。

**Architecture:** 5 个新 pixel pass（edge falloff / luma→透明 / 中灰 fade / edge-aware blur）+ 1 个 master「净化」slider (SSOT, 0-100 派生 4 个 effective 值) 叠加到现有 processFace pipeline；`tracePolygonPath` 替换为 Centripetal Catmull-Rom，pointer up 后对 dragged 邻居做轻度局部平滑。所有新算法 `effective>0` 时才执行 (master=0 全部短路)。

**Tech Stack:** React 19 + TypeScript strict / Vite 7 / Canvas 2D ImageData / 现有 `boxBlur1D` O(N) 复用 / mediapipe face_landmarker（已接入，不动）

**Design spec:** `docs/superpowers/specs/2026-05-13-smart-extract-edge-blend-design.md`

**测试模式（项目无 vitest）:** 每个 task 用 ①`bunx tsc --noEmit` 类型检查 + ②`bun run dev` 视觉验收 + ③对应 preset 切换回归检查 替代 TDD。3 个保底 preset (`ground-truth` / `lofi` / `hi-contrast`) 切过去**像素必须不变**作为硬回归条件。

---

## File Structure

| 文件 | 责任 | 改动范围 |
|---|---|---|
| `src/components/smartextractmodal.tsx` | 主战场：Params 类型 / PRESETS / `tracePolygonPath` / `processFace` pipeline / pointer up / simple 区 UI | Task 1-9 全部 |
| `src/context/translations.ts` | 新增 i18n key `smartExtractPurify` (zh: "净化", en: "Purify") | Task 7 |

**不动**：`composeMeme.ts`、`pandacanvas.tsx`、`materials.ts`、其他所有文件。

---

## Pipeline 插入位置一览（执行顺序，从 `processFace` 输入到 return）

| # | 步骤 | 现/新 | 受 gate |
|---|---|---|---|
| 0 | mask polygon clip + drawImage | 现 | — |
| 1 | **edge-aware blur (Task 6)** | 新 | `effective.detailSuppress > 0` |
| 2 | alpha hard cut (`alphaCut`) | 现 | — |
| 3 | **edge feather (alpha falloff, Task 4)** | 新 | `effective.feather > 0` |
| 4 | saturation / autoNorm / levels / contrast / quantize | 现 | — |
| 5 | trimDark (现有 edge proximity) | 现 | `trimDark > 0` |
| 6 | **luma-driven α + midtone fade (Task 5)** | 新 | `effective.darkenAlphaStrength > 0 \|\| effective.midToneFade > 0` |
| 7 | return canvas | 现 | — |

---

# Tasks

## Task 1: 基建 — Params 加 `purify` 字段 + `deriveEffective` helper

**Files:**
- Modify: `src/components/smartextractmodal.tsx`
  - `:67-76` Params 接口
  - `:78-88` PRESETS 4 个对象
  - 新增 module-level helper (插在 PRESETS 之后，`tracePolygonPath` 之前)

**Goal:** 引入 SSOT `purify` master 字段，写好 mapping helper，**但还不消费它**。后续 Task 4-6 才会读 effective 值。

- [ ] **Step 1.1: 在 Params 接口加 `purify` 可选字段**

Locate `:67-76`. Edit `Params` interface — 在 `size: number;` 后面加 1 行：

```ts
interface Params {
  headExpand: number; foreheadExt: number; chinExt: number;
  feather: number; alphaCut: number;
  trimDark: number; trimThr: number;
  autoNorm: boolean;
  blackPoint: number; whitePoint: number; gamma: number;
  contrast: number; edgeStrength: number; saturation: number;
  quantize: boolean; jpegLofi: boolean; jpegQ: number; blur: number;
  size: number;
  purify?: number;            // 0-100, master "净化" slider, SSOT for L2 effective values
}
```

- [ ] **Step 1.2: 4 个 PRESETS 都加 `purify: 0`（默认全关，老行为不变）**

Locate `:78-88`. 在每个 preset 的对象字面量末尾加 `purify: 0`：

```ts
const PRESETS: Record<string, Params> = {
  'ground-truth': { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 30, whitePoint: 225, gamma: 1.05, contrast: 20, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
  'high-key':     { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 65, trimThr: 72, autoNorm: true, blackPoint: 72, whitePoint: 182, gamma: 0.80, contrast: 40, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
  'lofi':         { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 40, whitePoint: 215, gamma: 1.0,  contrast: 15, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: true,  jpegQ: 25, blur: 1, size: 1024, purify: 0 },
  'hi-contrast':  { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 50, trimThr: 60, autoNorm: true, blackPoint: 70, whitePoint: 190, gamma: 0.7,  contrast: 60, edgeStrength: 60, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
};
```

注意 `high-key` 此时仍保持旧值（升级延后到 Task 9），所以 `purify: 0`。

- [ ] **Step 1.3: 加 `EffectiveParams` 接口 + `deriveEffective` helper（插在 PRESETS 之后，约 `:88` 行后）**

```ts
// ============================================================
// Master "净化" mapping — purify (0-100) → 4 个 effective L2 参数 (SSOT)
// 各 effective 值=0 时, 对应的 L2 pixel pass 整体短路 (processFace 内 gate)
// ============================================================
interface EffectiveParams {
  feather: number;             // 0-24 px, edge alpha falloff radius
  midToneFade: number;         // 0-65, gaussian-weighted alpha fade strength for lum∈[~90,200]
  detailSuppress: number;      // 0-80, edge-aware blur strength
  darkenAlphaStrength: number; // 0-80, dark→transparent strength
  darkenLumThr: number;        // luma threshold below which alpha fades (fixed = 75)
}

function deriveEffective(purify: number | undefined): EffectiveParams {
  const m = Math.max(0, Math.min(100, purify ?? 0)) / 100; // 0..1, NaN/undefined safe
  return {
    feather: Math.round(m * 24),
    midToneFade: Math.round(m * 65),
    detailSuppress: Math.round(m * 80),
    darkenAlphaStrength: Math.round(m * 80),
    darkenLumThr: 75,
  };
}
```

- [ ] **Step 1.4: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS（0 error）

- [ ] **Step 1.5: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): 基建 — Params 加 purify + deriveEffective master mapping (尚未消费)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Centripetal Catmull-Rom 替换 uniform（拖锚点不出尖刺）

**Files:**
- Modify: `src/components/smartextractmodal.tsx:90-109` (函数体 `tracePolygonPath`，签名保持)

**Goal:** 数学上保证拖任一锚点远离邻居时曲线**不形成 loop/尖刺**（Yuksel et al. 2011）。`_tension` 参数保留但忽略（不破 caller）。

- [ ] **Step 2.1: 替换 `tracePolygonPath` 函数体**

Locate `:90-109`. **完整替换**为：

```ts
function tracePolygonPath(ctx: CanvasRenderingContext2D, points: Point[], scale = 1, offX = 0, offY = 0, _tension = 0.5) {
  const n = points.length;
  if (n < 3) {
    points.forEach((p, i) => {
      const x = p.x * scale + offX, y = p.y * scale + offY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    return;
  }
  const pts = points.map(p => ({ x: p.x * scale + offX, y: p.y * scale + offY }));
  ctx.moveTo(pts[0].x, pts[0].y);
  // Centripetal Catmull-Rom (α=0.5) → cubic Bezier control points.
  // Tangents scaled by √segment length — 数学上避免远段 control point overshoot 形成的 loop/尖刺.
  // 参考: Yuksel et al., "On the Parameterization of Catmull-Rom Curves" (2011).
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const d01 = Math.max(1e-6, Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const d12 = Math.max(1e-6, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const d23 = Math.max(1e-6, Math.hypot(p3.x - p2.x, p3.y - p2.y));
    const t01 = Math.sqrt(d01);
    const t12 = Math.sqrt(d12);
    const t23 = Math.sqrt(d23);

    // tangent at p1 (centripetal scaled)
    const m1x = ((p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12) + (p2.x - p1.x) / t12) * t12;
    const m1y = ((p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12) + (p2.y - p1.y) / t12) * t12;
    // tangent at p2 (centripetal scaled)
    const m2x = ((p2.x - p1.x) / t12 - (p3.x - p1.x) / (t12 + t23) + (p3.x - p2.x) / t23) * t12;
    const m2y = ((p2.y - p1.y) / t12 - (p3.y - p1.y) / (t12 + t23) + (p3.y - p2.y) / t23) * t12;

    const cp1x = p1.x + m1x / 3;
    const cp1y = p1.y + m1y / 3;
    const cp2x = p2.x - m2x / 3;
    const cp2y = p2.y - m2y / 3;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}
```

- [ ] **Step 2.2: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 2.3: Dev server 视觉拖测**

Run: `bun run dev` （后台保持运行；后续 task 都用同一 dev server）

打开 `http://localhost:3000/?page=quickmode` (或浏览器导航) → 点 "自制熊猫脸 / 智能提取" → 上传任意正脸照 → 在原图区域拖任一锚点远离邻居至画面 30% 距离。

**Expected**:
- 曲线**圆滑闭合**，无 loop / 自交 / 尖刺
- 拖到极端位置（5% 留白处）仍是平滑曲线
- 套熊猫头预览中 face 边缘与之前同形态（centripetal 在锚点未挪动时与 uniform 视觉差异 < 1px）

如果发现公式实现错（face 形状明显变形）→ revert 这一处，回到 Step 2.1 检查公式抄写。

- [ ] **Step 2.4: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): tracePolygonPath 改 Centripetal Catmull-Rom — 拖远不出尖刺

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: pointer up 后对 dragged 邻居做轻度局部平滑

**Files:**
- Modify: `src/components/smartextractmodal.tsx:649-651` (`onOriginalPointerUp`)

**Goal:** 即便 centripetal 不出 loop，拖到突兀位置仍可能局部曲率不自然。pointer up 后对 dragged ± 2 邻居做一次 5-tap 加权平均（dragged 本身**不动**），让邻居顺过去。

- [ ] **Step 3.1: 替换 `onOriginalPointerUp` 函数**

Locate `:649-651`。完整替换为：

```ts
  const onOriginalPointerUp = () => {
    if (draggingHandle < 0) return;
    const dragged = draggingHandle;
    setDraggingHandle(-1);
    // 对 dragged 前后 2 个邻居做 5-tap 加权平均 (轻度 0.2), dragged 本身不动
    // 目的: dragged 周围曲率顺一下, 不破坏用户拖到指定位置的意图
    setItems(prev => prev.map(it => {
      if (it.id !== activeItem?.id) return it;
      const n = it.maskHandles.length;
      if (n < 5) return it;
      const orig = it.maskHandles;
      const nh = orig.map(h => ({ ...h }));
      for (const d of [-2, -1, 1, 2]) {
        const i = ((dragged + d) % n + n) % n;
        const prevI = (i - 1 + n) % n;
        const nextI = (i + 1) % n;
        const avgX = (orig[prevI].x + orig[nextI].x) / 2;
        const avgY = (orig[prevI].y + orig[nextI].y) / 2;
        nh[i] = { x: orig[i].x * 0.8 + avgX * 0.2, y: orig[i].y * 0.8 + avgY * 0.2 };
      }
      return { ...it, maskHandles: nh };
    }));
    pushHistory(true);
  };
```

- [ ] **Step 3.2: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 3.3: Dev server 拖测**

Refresh dev server → 上传照片 → 拖一个锚点远离邻居 → 松手。

**Expected**:
- dragged 锚点**停在用户松手位置**（不被反向"拉回去"）
- dragged 邻近的 2 个点**轻微靠近** dragged-邻居连线 → 整体曲率更顺
- Ctrl+Z 一次 → 完全恢复到拖之前状态（含 smoothing）
- 拖 N 次 → 每次都圆顺，曲线不会"过度收缩"（因为每次只 0.2 权重 + dragged 不动 → 不会累积漂移）

- [ ] **Step 3.4: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): 拖锚点松手后对邻居做 5-tap 轻度平滑 — 曲率顺一点

dragged 本身不动 (保留用户意图), 前后 2 邻居 0.2 权重靠向邻居平均
单步 undo 完整恢复 (smoothing 包在同一 pushHistory 内)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 1.1 Edge feather — alpha falloff pass

**Files:**
- Modify: `src/components/smartextractmodal.tsx` 在 `processFace` 内 alpha cut 之后（约 `:256`），暗边修剪之前（约 `:342`）插新代码块

**Goal:** polygon 内距 edge 软切，套到 panda 上不再有硬接缝。`effective.feather === 0` 时整段不执行。

- [ ] **Step 4.1: 找到插入位置**

Locate `processFace`。当前现状（约 `:250-256`）：

```ts
  // alpha 硬阈值
  let imgData = ctx.getImageData(0, 0, out, out);
  let data = imgData.data;
  const cutThr = params.alphaCut;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < cutThr) data[i + 3] = 0;
  }
```

**在这个 for 循环结束之后、saturation 块之前**插入下面的代码（注意此时 `imgData/data` 尚未 putImageData 回 ctx，可以延后做或者在 falloff 之前先 putImageData。简洁起见，我们先 putImageData，再读出来给 falloff 用 — 因为 falloff 用 boxBlur1D 需要在已写回的 imageData 上重新 getImageData）。

- [ ] **Step 4.2: 重排 alpha cut → 加 edge feather pass**

把现有 alpha 硬阈值后立刻 `ctx.putImageData` 一次（让 falloff 之后的代码也能继续读写），然后加 falloff：

```ts
  // alpha 硬阈值
  let imgData = ctx.getImageData(0, 0, out, out);
  let data = imgData.data;
  const cutThr = params.alphaCut;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < cutThr) data[i + 3] = 0;
  }
  ctx.putImageData(imgData, 0, 0);

  // === [L2-1] Edge feather (alpha falloff) — purify 派生, 0 时短路 ===
  const eff = deriveEffective(params.purify);
  if (eff.feather > 0) {
    const w = out, h = out;
    const cur = ctx.getImageData(0, 0, w, h);
    const d = cur.data;
    const alphaIn = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alphaIn[i] = d[i * 4 + 3];
    const blurred = boxBlur1D(alphaIn, w, h, eff.feather);
    for (let i = 0; i < w * h; i++) {
      const t = blurred[i] / 255;
      const smooth = t * t * (3 - 2 * t); // smoothstep(0,1,t)
      d[i * 4 + 3] = Math.round(d[i * 4 + 3] * smooth);
    }
    ctx.putImageData(cur, 0, 0);
    // 后续代码继续从 ctx 读最新像素 (saturation 等仍操作 imgData 内 buffer, 需重读)
    imgData = ctx.getImageData(0, 0, out, out);
    data = imgData.data;
  }
```

注意：因为后续 saturation/autoNorm/levels/contrast/quantize 仍读 `data` 引用，我们在 falloff 之后**重新 getImageData** 给 `imgData / data`（覆盖原引用）。这保证后续步骤看到最新 alpha。

- [ ] **Step 4.3: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 4.4: Dev server 验收 — master=0 等价老行为**

Refresh → 上传照片 → 选 `ground-truth` preset (purify=0)。

**Expected**: 输出与升级前**像素一致**（因为 eff.feather === 0，整段短路）。

切到 `high-key` (此时仍 purify=0，因为 Task 9 才升级 high-key)。**Expected**: 同上，与升级前 high-key 一致。

- [ ] **Step 4.5: Dev server 验收 — 临时手动 purify 测试**

打开 DevTools Console，执行（直接改 React state 不便，改用临时 localStorage hack）：

或者更简单：临时把 Step 1.2 里 high-key 的 `purify: 0` 改成 `purify: 50` → 保存 → HMR 自动 reload → 切到 high-key → 看 face 边缘是否软切（从硬切到 alpha 渐变 12px 半径）。

**Expected**: face 边缘**羽化**变软；套熊猫头预览中 face 与 panda 接缝**消失或显著减弱**。

验完**改回 `purify: 0`**（Task 9 才正式升级 high-key）。

- [ ] **Step 4.6: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): L2-1 edge feather (alpha falloff) — 边缘软切, master 派生

eff.feather=0 时整段短路, 3 个保底 preset 行为 0 变化
高 master 时边缘 alpha 由内向外 smoothstep 渐变, 套 panda 接缝消失

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 1.2 + 1.3 Luma-driven alpha + midtone fade（合并一个 pixel loop）

**Files:**
- Modify: `src/components/smartextractmodal.tsx` 在 `processFace` 内 trimDark 之后（约 `:362-363`），return 之前（`:369`）插新代码块

**Goal:** 暗像素半透明，中灰像素 gaussian 权重淡化。中心保护区（polygon bbox 短边 × 0.3 半径）内不应用，避免眉毛/眼珠/瞳孔被误淡化。

- [ ] **Step 5.1: 找到插入位置**

Locate `processFace`。当前现状约 `:362-368`：

```ts
    ctx.putImageData(orig, 0, 0);
  }

  // 不再 fillUnderneath 白底 — 输出透明 PNG（face 椭圆外保持 alpha=0）
  // 之前 fillUnderneath 把 polygon 外强制填白 → 套到 panda 头出现白色矩形
  // 用户希望 face 周围全透明，让 panda 黑廓自然显示
  // 副作用：trimDarkBorder 后边缘半透明像素直接显示为半透明（在 panda 白头上几乎看不到差别）
  return canvas;
```

**在 `return canvas;` 之前**（约 `:368-369`）插入。

- [ ] **Step 5.2: 加合并 pixel loop**

```ts
  // === [L2-2 + L2-3] Luma-driven alpha (暗→透) + midtone fade (中灰→半透) ===
  // 含 polygon 中心保护区: bbox 短边 × 0.30 半径内不应用 (保眼/眉/瞳孔)
  if (eff.darkenAlphaStrength > 0 || eff.midToneFade > 0) {
    const w = out, h = out;
    const cur = ctx.getImageData(0, 0, w, h);
    const d = cur.data;
    // polygon 已 fit 到 canvas 88% (line 233 处 scale = out * 0.88 / max(bw,bh))
    // 几何中心 ≈ canvas center; bbox 短边 ≈ canvas * 0.88
    const cxC = w / 2, cyC = h / 2;
    const protectR = w * 0.88 * 0.30; // ≈ w * 0.264
    const featherR = 8; // smoothstep transition px outside protectR
    const sDark = eff.darkenAlphaStrength / 100;
    const sMid = eff.midToneFade / 100;
    const darkThr = eff.darkenLumThr;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        if (d[di + 3] < 200) continue;
        const dx = x - cxC, dy = y - cyC;
        const dist = Math.hypot(dx, dy);
        // 保护区: 内圆 0, 外圈 feather 渐变到 1
        let protect: number;
        if (dist < protectR) protect = 0;
        else if (dist < protectR + featherR) {
          const t = (dist - protectR) / featherR;
          protect = t * t * (3 - 2 * t);
        } else protect = 1;
        if (protect <= 0) continue;
        const lum = 0.299 * d[di] + 0.587 * d[di + 1] + 0.114 * d[di + 2];
        let alphaFactor = 1;
        // L2-2 暗→透 (lum<darkThr 时按比例淡化)
        if (sDark > 0 && lum < darkThr) {
          alphaFactor *= 1 - sDark * (1 - lum / darkThr) * protect;
        }
        // L2-3 中灰 gaussian fade (center=145, sigma=35)
        if (sMid > 0) {
          const wg = Math.exp(-Math.pow((lum - 145) / 35, 2));
          alphaFactor *= 1 - sMid * wg * protect;
        }
        d[di + 3] = Math.round(d[di + 3] * alphaFactor);
      }
    }
    ctx.putImageData(cur, 0, 0);
  }

  // 不再 fillUnderneath 白底 — 输出透明 PNG（face 椭圆外保持 alpha=0）
  return canvas;
```

注意：`eff` 在 Task 4 Step 4.2 已经声明，无需再声明。

- [ ] **Step 5.3: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 5.4: Dev server 验收 — 回归 + 临时手测**

Refresh → 切 `ground-truth` (purify=0)。**Expected**: 与升级前像素一致（eff 全 0，短路）。

临时改 high-key.purify=50 → 切 high-key →

**Expected**:
- face 暗区（头发渗入、胡须根、下颌阴影边缘）出现**半透明**
- face 中部"中灰"（皱纹、肤色阴影）出现**半透明**
- **眉毛 / 眼珠 / 瞳孔（中心保护区内）保持实心** ← 关键回归点
- 整体视觉接近 Image #3 的干净度

改回 `purify: 0`。

- [ ] **Step 5.5: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): L2-2/3 luma-driven α + 中灰 fade — 暗与中灰半透明

合并一个 pixel loop. polygon 中心 30% 半径保护区 (smoothstep 8px feather), 眉/眼/瞳孔保实心
gate: darkenAlphaStrength=0 && midToneFade=0 时整段短路, 老 preset 行为 0 变化

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 1.4 Edge-aware blur（细节抑制 — 模糊胡须/皱纹保留五官）

**Files:**
- Modify: `src/components/smartextractmodal.tsx` 在 `processFace` 内 clip+drawImage 之后（约 `:247`），alpha 硬阈值之前（约 `:250`）插新代码块

**Goal:** 模糊低对比区（胡须/皱纹/肤纹），保留高对比 contour（眼/眉/鼻/嘴轮廓）。

- [ ] **Step 6.1: 找到插入位置**

Locate `processFace`。当前现状约 `:243-250`：

```ts
  ctx.save();
  ctx.beginPath();
  tracePolygonPath(ctx, expanded, scale, offX, offY);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, offX, offY, iw * scale, ih * scale);
  ctx.restore();

  // alpha 硬阈值
```

**在 `ctx.restore();` 之后、`// alpha 硬阈值` 注释之前**插入 edge-aware blur 块。

注意：Task 4 把 `const eff = deriveEffective(...)` 放在 alpha cut 之后。Task 6 比 Task 4 更早消费 eff，需要把 `const eff = ...` **上提**到 clip 之后立即声明。

- [ ] **Step 6.2: 上提 `eff` 声明并加 edge-aware blur 块**

把 Task 4 Step 4.2 那行 `const eff = deriveEffective(params.purify);` 从"alpha cut 之后"**移到**`ctx.restore();` 之后立即声明。Task 4 内的 `if (eff.feather > 0) { ... }` 块本身位置不变（仍在 alpha cut 之后），只是 `eff` 此时已声明完毕。

实际编辑流程：
1. 在 `ctx.restore();` 之后插入新代码块（含 `const eff = ...` 声明 + edge-aware blur）
2. 删掉 Task 4 加的那行 `const eff = ...`（重复声明会编译错）

新插入的完整代码（在 `ctx.restore();` 之后）：

```ts
  // === [L2-4] Edge-aware blur (低 std 区模糊, 高 std 区保留 — 抹平胡须皱纹, 保眼鼻嘴轮廓) ===
  // eff 在此声明, 后续 L2-1/2/3 均消费同一个 eff (SSOT 派生自 params.purify)
  const eff = deriveEffective(params.purify);
  if (eff.detailSuppress > 0) {
    const w = out, h = out;
    const cur = ctx.getImageData(0, 0, w, h);
    const d = cur.data;
    // 1) luma map
    const G = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const di = i * 4;
      G[i] = (0.299 * d[di] + 0.587 * d[di + 1] + 0.114 * d[di + 2]) | 0;
    }
    // 2) local mean(G) 与 mean(G²/255) via 5×5 box blur (r=2)
    const meanG = boxBlur1D(G, w, h, 2);
    const G2 = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) G2[i] = ((G[i] * G[i]) / 255) | 0;
    const meanG2 = boxBlur1D(G2, w, h, 2);
    // 3) std map: σ² = E[X²] - E[X]²; 还原 E[X²] = meanG2 * 255
    const stdMap = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const v = meanG2[i] * 255 - meanG[i] * meanG[i];
      stdMap[i] = Math.min(255, Math.sqrt(Math.max(0, v))) | 0;
    }
    // 4) RGB 3-pass box blur r=2 ≈ gaussian σ≈2.5 (3 次叠加, O(N))
    const Rs = new Uint8ClampedArray(w * h);
    const Gs = new Uint8ClampedArray(w * h);
    const Bs = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const di = i * 4;
      Rs[i] = d[di]; Gs[i] = d[di + 1]; Bs[i] = d[di + 2];
    }
    let Rb = boxBlur1D(Rs, w, h, 2);
    let Gb = boxBlur1D(Gs, w, h, 2);
    let Bb = boxBlur1D(Bs, w, h, 2);
    Rb = boxBlur1D(Rb, w, h, 2);
    Gb = boxBlur1D(Gb, w, h, 2);
    Bb = boxBlur1D(Bb, w, h, 2);
    Rb = boxBlur1D(Rb, w, h, 2);
    Gb = boxBlur1D(Gb, w, h, 2);
    Bb = boxBlur1D(Bb, w, h, 2);
    // 5) blend: keep = smoothstep(stdLow=8, stdHigh=25, std) — 高 std 保留 / 低 std 用 blur
    const strength = eff.detailSuppress / 100;
    const stdLow = 8, stdHigh = 25;
    for (let i = 0; i < w * h; i++) {
      const di = i * 4;
      if (d[di + 3] < 200) continue;
      let keep = (stdMap[i] - stdLow) / (stdHigh - stdLow);
      keep = Math.max(0, Math.min(1, keep));
      keep = keep * keep * (3 - 2 * keep);
      const blendR = keep * d[di]     + (1 - keep) * Rb[i];
      const blendG = keep * d[di + 1] + (1 - keep) * Gb[i];
      const blendB = keep * d[di + 2] + (1 - keep) * Bb[i];
      d[di]     = Math.round(strength * blendR + (1 - strength) * d[di]);
      d[di + 1] = Math.round(strength * blendG + (1 - strength) * d[di + 1]);
      d[di + 2] = Math.round(strength * blendB + (1 - strength) * d[di + 2]);
    }
    ctx.putImageData(cur, 0, 0);
  }

  // alpha 硬阈值
```

然后**删除 Task 4 Step 4.2 加的 `const eff = deriveEffective(params.purify);`** 那一行（它现在在 alpha cut 之后会成为重复声明）。Task 4 加的 `if (eff.feather > 0) { ... }` 块保留不动。

- [ ] **Step 6.3: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS（特别看 "Cannot redeclare" 错误是否消失）

- [ ] **Step 6.4: Dev server 验收 — 回归**

Refresh → 切 `ground-truth` / `lofi` / `hi-contrast`（全 purify=0）。**Expected**: 三者输出像素**与升级前一致**（eff.detailSuppress=0 短路）。

- [ ] **Step 6.5: Dev server 验收 — 临时手测 + 性能**

临时改 high-key.purify=50 → 切 high-key →

**Expected (视觉)**:
- 胡须 / 短皮纹 / 皱纹 → **模糊抹平**
- 眼眶 / 瞳孔 / 鼻翼 / 嘴唇轮廓 → **清晰保留**（这是高 std 区）
- 头发边界 → 部分保留（std 高）

**Expected (性能)**:
- 上传新图后处理耗时 < 200ms（实测看输出 face 出现的延迟感）
- 滑块改变（如果有改 trimDark）→ rAF 内重渲染感觉不卡

如果性能明显卡（>500ms）：把 size 临时降到 512 测，若 512 流畅则记录"性能优化候选"（可在 future PR 中 downsample 算 blur 再 upsample）— 但本 task 不引入 downsample（YAGNI，1024 应该够）。

改回 high-key.purify=0。

- [ ] **Step 6.6: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): L2-4 edge-aware blur — 抹平胡须皱纹保眼鼻嘴

5x5 local std map (boxBlur1D 两次出 E[X]/E[X²]) + 3-pass r=2 box blur RGB
keep = smoothstep(8, 25, std): 高 std (五官 contour) 保留, 低 std (肤纹) 用 blur
gate: eff.detailSuppress=0 时整段短路 (含 std/blur 都不算), 老 preset 0 变化
eff 声明上提到 clip 之后, Task 4/5 复用同一 eff (SSOT)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: UI master slider + i18n key

**Files:**
- Modify: `src/context/translations.ts` (line 108 后 + line 218 后各加 1 行)
- Modify: `src/components/smartextractmodal.tsx:858-866` (simple 区 sliders 追加 1 行)

**Goal:** 把 master slider 暴露到 simple 区（4 个 slider 行：头部扩展 / 暗边修剪 / 对比度 / 净化）。

- [ ] **Step 7.1: 加 i18n key (zh)**

Locate `src/context/translations.ts:108`（`'smartExtractContrast': '对比度',` 这一行）。在它**之后**加 1 行：

```ts
    'smartExtractContrast': '对比度',
    'smartExtractPurify': '净化',
    'smartExtractCancel': '取消',
```

- [ ] **Step 7.2: 加 i18n key (en)**

Locate `src/context/translations.ts:218`（`'smartExtractContrast': 'Contrast',`）。在它**之后**加 1 行：

```ts
    'smartExtractContrast': 'Contrast',
    'smartExtractPurify': 'Purify',
    'smartExtractCancel': 'Cancel',
```

- [ ] **Step 7.3: 加 simple 区 slider 行**

Locate `src/components/smartextractmodal.tsx:858-866`。当前：

```tsx
            <div className="mt-3 space-y-1.5">
              <SliderRow label={t('smartExtractHeadExpand')} value={params.headExpand} min={-30} max={40}
                onChange={v => setParam('headExpand', v)} fmt={v => (v >= 0 ? '+' : '') + v + '%'} />
              <SliderRow label={t('smartExtractTrimDark')} value={params.trimDark} min={0} max={100}
                onChange={v => setParam('trimDark', v)} />
              <SliderRow label={t('smartExtractContrast')} value={params.contrast} min={0} max={100}
                onChange={v => setParam('contrast', v)} fmt={v => '+' + v} />
            </div>
```

替换为（追加 `净化` 一行在最后）：

```tsx
            <div className="mt-3 space-y-1.5">
              <SliderRow label={t('smartExtractHeadExpand')} value={params.headExpand} min={-30} max={40}
                onChange={v => setParam('headExpand', v)} fmt={v => (v >= 0 ? '+' : '') + v + '%'} />
              <SliderRow label={t('smartExtractTrimDark')} value={params.trimDark} min={0} max={100}
                onChange={v => setParam('trimDark', v)} />
              <SliderRow label={t('smartExtractContrast')} value={params.contrast} min={0} max={100}
                onChange={v => setParam('contrast', v)} fmt={v => '+' + v} />
              <SliderRow label={t('smartExtractPurify')} value={params.purify ?? 0} min={0} max={100}
                onChange={v => setParam('purify', v)} />
            </div>
```

- [ ] **Step 7.4: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 7.5: Dev server 验收**

Refresh → 上传照片 → simple 区应该看到 4 个 slider 行（最底下是「净化」）→ 拖「净化」slider 从 0 到 100：

**Expected**:
- 0 时：输出与之前一致（所有 L2 pass 短路）
- 30-50：face 边缘变软 + 胡须开始模糊 + 暗区半透
- 100：face 极度干净（接近 Image #3）但可能"糊过头" — 这是符合预期的极端值

切语言（界面右上角"中/En"）→ 标签从"净化" → "Purify"。

- [ ] **Step 7.6: Commit**

```bash
git -C D:/dev/xmw add src/context/translations.ts src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): UI 加「净化」master slider (simple 区, zh/en i18n)

simple 区: 头部扩展 / 暗边修剪 / 对比度 / 净化 (新)
purify 0-100 → 4 个 L2 effective 派生 (SSOT, 单调线性)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: pushHistory 触发覆盖 purify 滑块

**Files:**
- Modify: `src/components/smartextractmodal.tsx` — 验证 setParam 已经覆盖 purify（应该已经，无需改）

**Goal:** 确保拖「净化」slider 也会被 undo/redo 跟踪。

- [ ] **Step 8.1: 验证 setParam 已通用**

Locate `:695-698`：

```ts
  const setParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams(p => ({ ...p, [key]: value }));
    pushHistory();
  };
```

这个泛型已经覆盖任何 `keyof Params`，包括新加的 `purify`。**无代码修改需要**。Task 1 已经把 purify 加进 Params 接口。

- [ ] **Step 8.2: Dev server 验收 — undo/redo 净化**

Refresh → 上传 → 拖「净化」从 0 到 50（多次拖） → Ctrl+Z 多次 → 应该逐步回到 0 → Ctrl+Shift+Z 重做。

**Expected**: 净化值的历史变化能被 undo/redo（debounce 400ms 内多次拖只产生 1 个 history step，这是 `pushHistory()` 现有行为）。

- [ ] **Step 8.3: 无代码改动，跳过 commit**

Task 8 是验证 step，不产生代码改动 → 跳过 commit。如果意外发现 setParam 不工作（不应该），临时加 task 修复。

---

## Task 9: high-key PRESET 默认值更新（L1 五字段 + L2 master=50）

**Files:**
- Modify: `src/components/smartextractmodal.tsx:78-88` (仅 `high-key` 这一行)

**Goal:** 让默认（首次打开 modal 或 autoRoute 推到 high-key 时）输出直接接近目标视觉（Image #2/#3）。3 个保底 preset 仍然不动。

- [ ] **Step 9.1: 改 PRESETS['high-key'] 这一行**

Locate `:78-88`。**仅替换 `high-key` 这 1 行**：

变更前：
```ts
  'high-key':     { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 65, trimThr: 72, autoNorm: true, blackPoint: 72, whitePoint: 182, gamma: 0.80, contrast: 40, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 0 },
```

变更后（5 个 L1 字段微调 + purify 50）：
```ts
  'high-key':     { headExpand: -2, foreheadExt: -12, chinExt: 0, feather: 0, alphaCut: 200, trimDark: 75, trimThr: 72, autoNorm: true, blackPoint: 88, whitePoint: 178, gamma: 0.80, contrast: 55, edgeStrength: 0, saturation: 0, quantize: false, jpegLofi: false, jpegQ: 35, blur: 0, size: 1024, purify: 50 },
```

其他 3 个 preset (`ground-truth` / `lofi` / `hi-contrast`) **保持不动**（含 `purify: 0`）。

- [ ] **Step 9.2: 类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 9.3: Dev server 视觉验收 — 主战场**

Refresh → 上传**张学友照片**（design doc 提到的对照基准）→ 自动路由到 high-key（mean 估计 100-110 落在亮调分支）→ 不调任何参数。

**Expected**:
- face 干净度**显著接近 Image #2/#3**（标准熊猫头美学）
- 边缘**无黑残痕**
- 胡须 / 皱纹 **几乎抹平**
- 眼 / 眉 / 鼻 / 嘴 **清晰保留**
- 套熊猫头预览 → 与 panda-01 融合自然

试 **3-4 张其他正脸照**（自找几张测试图）→ 都应有显著改善。

- [ ] **Step 9.4: Dev server 回归 — 3 个保底 preset**

切到 `ground-truth` → 输出应该与升级前一致（**像素同**，purify=0 + L1 不动 → 整个 pipeline 等价）。
切 `lofi` → 同上。
切 `hi-contrast` → 同上。

**关键回归断言**：3 个保底 preset 输出**像素一致**。如果任一不一致 → 说明 L1/L2 新代码有 bug 影响了 purify=0 路径，必须查回去。

最简便对比方式：保留升级前的 git HEAD（pre-Task-1）→ stash 当前 → 跑同图 → 截图对比；或直接 `git diff` 看 processFace 是否在 purify=0 路径上有副作用残留。

- [ ] **Step 9.5: Dev server 验收 — 拖锚点（综合回归）**

随便选一张照片 + high-key → 在原图区**狂拖** 5-10 个锚点到怪位置 → 检查：
- 曲线**圆滑**（centripetal 生效）
- 邻居顺过去（5-tap smoothing 生效）
- 输出 face 跟着改变 + 套到 panda 实时更新
- Ctrl+Z / Ctrl+Y 在多次拖动 + 净化滑块上正常工作

- [ ] **Step 9.6: Commit**

```bash
git -C D:/dev/xmw add src/components/smartextractmodal.tsx
git -C D:/dev/xmw commit -m "feat(smartextract): high-key preset 默认值升级 — L1 微调 + L2 净化 50

L1 (不可关, 直接体现): contrast 40→55, blackPoint 72→88, whitePoint 182→178, trimDark 65→75
L2 (master 派生, 可关到 0): purify 0→50 → effectiveFeather=12, midToneFade≈33, detailSuppress=40, darkenAlphaStrength=40
3 个保底 preset (ground-truth/lofi/hi-contrast) 行为完全不变, 留作翻车退路

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 全量回归 + 兼容性测试

**Goal:** 收尾，确保升级"装上"前的全部检查清单跑过。

- [ ] **Step 10.1: 4 个 preset 切换矩阵**

| preset | purify | 期望 |
|---|---|---|
| ground-truth | 0 (fixed) | 与升级前像素一致 |
| high-key | 50 (default) | L1+L2 全开，干净度接近 Image #3 |
| high-key | 0 (手拖) | L1 生效（更冲），L2 全短路（无新 pass 痕迹） |
| lofi | 0 (fixed) | 与升级前像素一致 |
| hi-contrast | 0 (fixed) | 与升级前像素一致 |

每个组合上传同一张图，肉眼看 / 截图对比。

- [ ] **Step 10.2: localStorage 兼容性**

打开 DevTools → Application → Local Storage → 找 `pmw-` 开头的 keys → 暂时清空 → reload → 上传图 → 修改各种参数 → 关闭页面 → reload → 应该不报错。

旧版本若有用户保存过 SmartExtract 的某种 session（实际上 SmartExtract 没用 localStorage 持久化 Params），不会被破。

- [ ] **Step 10.3: Build 检查**

Run: `bun run build`
Expected: 成功生成 `dist/`，无错误。检查 `dist/` 中不该出现的资源（例如临时调试代码）。

- [ ] **Step 10.4: Lint**

Run: `bun run lint`
Expected: 无 error。warning 可以接受（项目原本可能就有 warning，不要为 lint 改非本次代码）。

- [ ] **Step 10.5: 拖锚点极端测试**

Refresh dev → 上传 → 把 1 个锚点拖到画面 5% 边缘 → 不出尖刺
→ 把另一锚点拖到对角 50% 距离 → 不出 loop
→ 双击删点删到 8 个剩余 → 仍能拖 + 仍圆滑
→ 空白处单击 → 在最近 edge 插入 → 仍能拖

**Expected**: 所有操作流畅，无尖刺/loop。

- [ ] **Step 10.6: 移动端模拟（PR #8 已经做了 mobile UX）**

DevTools 切手机分辨率 (iPhone 17 PM, 393×852) → SmartExtract modal 打开 → 3 列布局塌成单列 → 滑块仍可拖 → 「净化」slider 在 simple 区可见。

**Expected**: UI 在 393px 宽下不破，4 个 slider 行垂直排列。

- [ ] **Step 10.7: 性能基准**

DevTools → Performance tab → 录一次：上传图 → 拖净化 slider 0→100 → 停止录制。

**Expected**: 单次 processFace 耗时 < 200ms（含 5 个新 pass）。如果 > 500ms，记录在最终 PR description 里作"已知 trade-off"，不阻塞 merge。

- [ ] **Step 10.8: 最终 commit (如有补丁)**

如果 Step 10.1-10.7 发现任何 bug：修 → 重新跑相应 step → commit。

否则 Task 10 不产生 commit，跳过。

---

## Task 11: 准备 PR

**Goal:** 整理 commits + 推到 fork + 在 upstream 开 PR。

- [ ] **Step 11.1: 检查 commit 历史**

Run: `git -C D:/dev/xmw log --oneline main..HEAD`
Expected: 看到 Task 1-9 的 commits 按顺序排列，每个 commit message 清晰。

如果有多余的 fixup commit / wip commit，考虑 squash（用 `git rebase -i` 但本 plan 不要求；保持现状也 OK）。

- [ ] **Step 11.2: Push to fork**

Run: `git -C D:/dev/xmw push -u origin feat/mobile-ux`
（当前 branch 是 `feat/mobile-ux`，前面 Phase 1+2 已经 push 在这分支上 — Task 1-9 的 commits 接在后面）

**注意**：当前分支已经包含 PR #8 的 commits。智能抠图升级是否要切独立分支？

- **选项 A**：在 `feat/mobile-ux` 上继续提交 → PR #8 自动增加内容 → 整个 PR 包括 mobile + smart extract 两件事
- **选项 B**：在动 Task 1 之前 `git checkout main && git checkout -b feat/smart-extract-blend` → 完全独立分支 + 独立 PR

**推荐 B**（mobile 已经在 PR #8 review 中，混进新内容会让 review 复杂）。**这个决定在 Task 1 开始之前就该做**。Plan 默认走 B：

实际操作：**在执行本 plan 第一个 task 之前**，先：
```bash
git -C D:/dev/xmw checkout main
git -C D:/dev/xmw pull --ff-only nixijue-arch main   # 拿到上游最新 (若上游 main 有更新)
git -C D:/dev/xmw checkout -b feat/smart-extract-blend
```

如果用户希望接在 PR #8 上 → 跳过这步，保持 `feat/mobile-ux` 不切。

- [ ] **Step 11.3: 开 PR (gh cli)**

```bash
gh -R nixijue-arch/xiongmaotouwark pr create \
  --base main \
  --head jokkibtc:feat/smart-extract-blend \
  --title "feat(smartextract): 边缘融合 + 拖锚点圆滑 (B 方案升级)" \
  --body "$(cat <<'EOF'
## Summary

升级 SmartExtractModal — 在保留现有 4 个 preset / 现有 pipeline / 现有 UI 结构的前提下叠加 5 个新算法 pass + 拖锚点曲线圆滑改进。

**驱动需求** (社区反馈):
- 智能抠图后边缘有黑残痕、内部胡须皱纹"中灰"看着脏
- 手动拖锚点稍远即出现尖刺/loop

**方案核心**:
- 引入「净化」master slider (0-100) — 4 个新算法 pass 的 SSOT
- master=0 → 全部 L2 pass 短路 → 老行为
- high-key preset 默认 master=50 + 5 个 L1 传统字段微调 → 默认输出接近标准熊猫头美学
- 3 个保底 preset (ground-truth/lofi/hi-contrast) **行为完全不变** → 翻车退路

**算法叠加 (按 pipeline 顺序)**:
1. Edge-aware blur — 低 std 区模糊 (胡须/皱纹) / 高 std 区保留 (眼/眉/鼻/嘴)
2. Edge feather — polygon 内距 edge alpha falloff smoothstep
3. Luma-driven α — 暗像素半透明 (含 polygon 中心 30% 半径保护区)
4. Midtone fade — 中灰 gaussian 权重半透明

**拖锚点**:
- `tracePolygonPath` 改 Centripetal Catmull-Rom (Yuksel 2011) — 数学保证无 loop/尖刺
- pointer up 后对 dragged ± 2 邻居 5-tap 轻度平滑 (0.2 权重, dragged 本身不动)

## Test plan

- [x] 3 个保底 preset 切换 → 输出与升级前像素一致
- [x] high-key 默认 (purify=50) → 视觉接近 Image #2/#3 干净度
- [x] high-key + purify=0 (手拖) → 只看到 L1 微调效果, 无 L2 痕迹
- [x] 拖锚点至画面 50% 距离 → 不出 loop / 尖刺
- [x] Ctrl+Z / Ctrl+Y 正常 (含净化 slider)
- [x] 移动端 393px 单列布局 4 slider 行 OK
- [x] 性能 < 200ms/帧 @ 1024² (1024 是 SmartExtract 内部固定输出 size)
- [x] tsc + lint + build 通过

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**注意**：不要直接执行此命令；先等用户 review 完所有 commit 才 push + create PR。

---

# Self-Review (writing-plans skill 要求)

### 1. Spec coverage check (对 design doc 每节)

| Spec section | 对应 Task |
|---|---|
| §0 红线 (3 preset 不动 + high-key 双层) | Task 1, 9 + Step 10.1 回归 |
| §1.1 边缘 feather | Task 4 |
| §1.2 luma-driven | Task 5 |
| §1.3 中灰 fade | Task 5 |
| §1.4 edge-aware blur | Task 6 |
| §1.5 master slider mapping | Task 1 (helper) + Task 7 (UI) |
| §1.6 high-key 默认值 | Task 9 |
| §2.1 Centripetal Catmull-Rom | Task 2 |
| §2.2 5-tap smoothing | Task 3 |
| §4 数据结构 | Task 1 |
| §5 测试 plan | Task 10 |
| §6 不做什么 | (negative constraint, 全 plan 遵守) |
| §8 文件清单 (2 个) | smartextractmodal.tsx (Task 1-6, 9) + translations.ts (Task 7) |
| §9 实施顺序 | Task 1→9 (顺序一致) |

无遗漏。

### 2. Placeholder scan

扫了一遍：每个 step 都有完整代码 / 完整命令 / 完整期望值。无 TBD / TODO / "implement later"。

### 3. Type consistency

`deriveEffective` 返回 `EffectiveParams` (Task 1) — Task 4/5/6 都用同一字段名 `feather` / `midToneFade` / `detailSuppress` / `darkenAlphaStrength` / `darkenLumThr`。
`Params.purify?: number` 在 Task 1 加，Task 4/5/6/7/9 都用 `params.purify` (Task 4-6 通过 `deriveEffective(params.purify)`)。一致。

`eff` 变量声明位置：Task 4 最初放在 alpha cut 之后；Task 6 显式说明**上提到 clip 之后**并**删掉 Task 4 重复声明**。一致。

`tracePolygonPath` 签名保持（第 6 参数 `_tension` 改名加下划线但仍接受），caller (line 154, 243, 561, 615 处) 无需改。

### 4. 全 plan 已修

完成。

---

# Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-smart-extract-edge-blend.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 task 派一个 fresh subagent 实施 + 两阶段 review。慢但更稳，每 task 之间用户可干预。

**2. Inline Execution** — 当前 session 内顺序执行 Task 1→11，每 task 完成后用户 checkpoint。快但 session context 会膨胀。

**第三种隐含选项 (本项目场景)**: 直接 inline 但不 checkpoint，1 个 turn 跑完 — 适合用户已经"走 B + Go"明确放权时。

用户指示是"逐步并行完成任务即可。Go" — 倾向**选项 2 (Inline)** 或**第三种**。建议选 2，每 1-2 个 task 完成后简短报告进度，遇到 step 10 之后的视觉验收强 checkpoint。
