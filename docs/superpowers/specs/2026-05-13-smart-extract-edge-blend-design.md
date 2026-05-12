# 智能抠图边缘融合升级 + 手动选区圆滑（Design）

**日期**: 2026-05-13
**对象文件**: `src/components/smartextractmodal.tsx`
**驱动需求**: PR 用户反馈 — "边缘模糊化（更好融合）"+ "手动选区拖锚点容易变得极其尖锐"
**对照视觉**：
- 现状（Image #1）：智能抠图 face 套到 panda 后边缘有黑残痕、内部胡须/皱纹"中灰"看着脏
- 目标（Image #2 / #3）：panda-01 标准白脸 / 用户在编辑器手动改白后的干净融合
- 现状（Image #5）：拖锚点稍远即出现尖刺/loop

---

## 0. 最高约束（红线）

> **目前的抠脸方案"好用，只是需要做具体优化"。本次是升级，不是重构。**

1. **3 个保底 preset** (`ground-truth` / `lofi` / `hi-contrast`) **行为完全不动** — 切到任一个，输出像素与升级前一致（容差 = 0），作为"升级翻车时用户能立即切回去"的安全网。
2. **`high-key` 是本次升级的主战场**（默认 preset），有意被改得更接近 Image #2/#3 风格。升级分两层：
   - **L1 传统参数微调**（不可关）：`contrast / blackPoint / whitePoint / trimDark / feather` 5 项更激进。期望效果：默认输出比旧 high-key 更白更冲。回退路径 = 切 `ground-truth`。
   - **L2 新算法**（master 可关）：4 个新 pixel pass（边缘 feather / luma-driven / midtone fade / edge-aware blur）由「净化」master slider 0-100 统一控制。**master=0 时所有新 pass 跳过 → 输出 = L1 调整后的 high-key**（不是旧 high-key，但只受 L1 影响，无新算法痕迹）。
2. **现有 pipeline 步骤顺序不动**：mask polygon → clip → alpha cut → saturation → autoNorm → levels → contrast → quantize → trimDark → 输出。新算法**追加**或**插入**到 pipeline 中，受新参数 gate（默认值 = 0 / 关闭）。
3. **现有 UI 不重排** — simple 区 3 个 slider（头部扩展 / 暗边修剪 / 对比度）位置不变。新增 UI 是**加项**，加在已有结构内。
4. **现有数据格式不破** — Params 接口只**新增字段**，不改名 / 不删字段。Snapshot/历史栈、`localStorage` 兼容。
5. **手动选区拖拽**的数据结构（`Item.maskHandles: Point[]`）不变。改的只是**渲染曲线的函数** + **pointer up 后的一次平滑 pass**。

老行为回退方式：把"净化"主滑块拖到 0（master gate）→ pipeline 全部新算法不执行 → 像素回到升级前。

---

## 1. 现状摘要（代码定位）

| 模块 | 位置 | 现状关键点 |
|---|---|---|
| 算法 helpers | `src/components/smartextractmodal.tsx:14–195` | `tracePolygonPath` (catmull bezier) / `boxBlur1D` / `analyzeFace` / `autoRoute` |
| 主算法 `processFace` | `:198–370` | mask + clip + 风格化 + trimDark（只看边缘距） |
| PRESETS | `:78–88` | 4 个，含 `feather` 字段但**该字段未被 `processFace` 使用**（dead param） |
| 拖锚点交互 | `:578–676` | pointer down 找最近 handle 或 insert / move / up |
| simple UI | `:858–866` | 头部扩展 / 暗边修剪 / 对比度 |
| advanced UI | `:935–982` | 抠图 / 风格化 / 做旧 / 预览微调 |
| 下游消费 | `pandacanvas.tsx` + `composeMeme.ts` | face PNG alpha 通道原样 blend，**face 边缘 alpha 渐变会被正确显示** |

**关键发现**：
- `feather` 是 dead param（PRESETS 里设了 0，processFace 里没 read），现在可以**真正接起来**而不用引入新字段
- face 输出是透明 PNG，下游 composeMeme blend 时 alpha 通道完整保留 → soft-mask 改造**对下游无破坏**

---

## 2. Part 1 — 智能抠图升级（5 项独立可关）

### 1.1 让 `feather` 真正生效（边缘软切）

**问题**：当前 alpha 是硬切（`alphaCut: 200`），polygon 边界一刀切。套到 panda 上，边界与 panda 白脸有可见接缝；polygon 边缘像素若是头发/阴影颜色，直接表现为"黑残痕"。

**升级**：在 alpha cut 之后插入一个 **alpha falloff pass** — polygon 内距 edge < `feather` 像素的区域 alpha 线性渐变到 0。

**算法**：
- 复用现有 `boxBlur1D(alphaIn, w, h, r)`，参数 r 用 `Math.ceil(feather)`
- blurred alpha map 直接当做"内距 edge 强度" — 中心 ≈ 255，边缘 ≈ 0
- 最终 alpha = `originalAlpha * smoothstep(0, 255, blurred)`

**默认行为与 SSOT**：
- `params.feather` 字段（PRESETS 里现状全为 0，是 dead param）**继续保持为 0**，不再被 `processFace` 消费
- 真实生效的 `effectiveFeather` 完全由「净化」master 在 1.5 mapping 派生（master=0 → effective=0 → 老行为；master=50 → effective=12）
- 这样**避免双源**（"PRESETS.feather 是 12 还是 master 推出 12？"），SSOT 永远是 master

**代码插入点**：`processFace` 现有 alpha cut 之后（约 `:255` 之后），暗边修剪之前。

---

### 1.2 Luma-driven alpha（暗→透）

**问题**：当前 `trimDark` 只衡量"距 polygon edge 距离"，对 polygon 内部小块黑斑（头发渗入、胡须根部、下颌阴影边缘）无差别处理。用户原话："边缘大部分颜色偏黑到纯黑的区域，直接做成透明化"。

**升级**：在 trimDark 之后增加一个 **luma-driven alpha pass** — 对 lum < `darkenLumThr` 的像素，alpha 按比例淡化。

**算法**：
- 逐像素 lum = 0.299R + 0.587G + 0.114B
- 若 lum < `darkenLumThr`：alpha *= `1 - darkenAlphaStrength/100 * (1 - lum/darkenLumThr)`
  - lum=0 → alpha *= (1 - strength)
  - lum=darkenLumThr → alpha 不变（边界平滑）
- **保护区**：以 polygon 几何中心为圆心、polygon bbox 较短边 × 0.30 为半径的圆内**不应用**（避免眉毛/眼珠/瞳孔这种"必须保留的暗"被淡化）。圆外按本节算法淡化；圆边界用 smoothstep 过渡 8px 避免硬切。

**默认行为**：`darkenAlphaStrength = 0` → 不执行 → 老行为。
- `high-key` 默认 `darkenAlphaStrength: 40, darkenLumThr: 75`

**代码插入点**：`processFace` 现有 trimDark 之后（约 `:363`），return 之前。

---

### 1.3 中灰透明化（mid-tone fade）

**问题**：胡须/皱纹/下颌侧 lum∈[90,200] 的"中灰"像素，标准熊猫头美学要么纯黑要么纯白。用户原话："面部细节（例如人的皱纹/胡须）可以做模糊+透明化处理"。

**升级**：对 lum 在 `[midLow, midHigh]` 区间的像素 alpha 按 Gaussian 权重淡化（中心 lum=145 权重最大）。

**算法**：
- 对每像素：`w = exp(-((lum - 145) / sigma)^2)`，sigma ≈ 35
- alpha *= `1 - midToneFade/100 * w`
- 同样有**中心保护区**（同 1.2 — polygon bbox 短边 × 0.30 半径，圆内不应用，边界 smoothstep 8px）

**默认行为**：`midToneFade = 0` → 不执行 → 老行为。
- `high-key` 默认 `midToneFade: 35`

**代码插入点**：和 1.2 合并到同一个 pixel-loop（避免重复遍历）。

---

### 1.4 Edge-aware blur（细节抑制 / 保边模糊）

**问题**：上面 1.2/1.3 是逐像素 alpha 操作，但**毛刺状的细节**（短胡渣/皱纹纹理）即使 alpha 淡化后仍呈现"半透明的细线条"，视觉上还是脏。用户原话："面部细节做**模糊**+透明化处理"。

**升级**：在 alpha 操作前，对**低对比度区域**做 box-blur（多 pass 叠加 ≈ 高斯），保留**高对比度边缘**（五官 contour）。

**算法**：
1. 灰度图 G（用现成 luma）
2. local std map（5×5 窗口）：
   - `meanG[i] = boxBlur1D(G, w, h, 2)` （半径 2 → 5×5）
   - `G2[i] = G[i] * G[i] / 255`（缩到 [0,255] 避免溢出 Uint8ClampedArray）
   - `meanG2[i] = boxBlur1D(G2, w, h, 2)`
   - `std[i] = sqrt( max(0, meanG2[i] * 255 - meanG[i] * meanG[i]) )`
   - 注：现有 `boxBlur1D` 接 `Uint8ClampedArray`，本步骤用同一份签名（结果范围内即可），不引入新 helper
3. 模糊版 RGB = box-blur 3 pass，r=2（≈ Gaussian σ≈2.5）
4. 权重 `keep = smoothstep(stdLow, stdHigh, std)` — stdLow=8, stdHigh=25
5. 每像素 `RGB_out = lerp(blurred, original, keep) * detailSuppress/100 + original * (1 - detailSuppress/100)`
   - detailSuppress=0 → 全保留原图 → 老行为
   - detailSuppress=100 → 低对比区完全用 blur 版本，高对比区完全保留

**默认行为**：`detailSuppress = 0` → 不执行 → 老行为。
- `high-key` 默认 `detailSuppress: 40`

**性能**：1024² × 3-pass box-blur，本地测算 30-50ms（box-blur 是 O(N) 不是 O(N·r²)）。

**代码插入点**：`processFace` clip 之后、alpha cut 之前（约 `:248`）。**仅当 detailSuppress > 0** 时执行（避免老 preset 多花时间）。

---

### 1.5 master "净化" slider（UI 不重排，只加一个）

**问题**：1.1-1.4 引入 4 个新参数。如果都暴露给 simple 区会变 7 个 slider，破坏现有 UI（违反约束）。

**升级**：在 simple 区**加一个** slider「净化」(0-100)，**simple 区从 3 个 → 4 个 slider**。"净化"是 master，内部映射到 4 个细参数：

| master | edgeFeather | midToneFade | detailSuppress | darkenAlphaStrength |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 25 | 6 | 18 | 20 | 20 |
| 50 | 12 | 35 | 40 | 40 |
| 75 | 18 | 50 | 60 | 60 |
| 100 | 24 | 65 | 80 | 80 |

线性插值即可（不需要 LUT，简单乘法）。

**advanced 区不暴露这 4 个内部参数**（保持 advanced 区当前结构不动）。如果将来用户要精细控制，再加。

**master 默认值**：
- `high-key`: 50
- 其他 3 个 preset: 0（行为完全不变）

**UI 改动**：
- `:860-866` simple 区 sliders 列表内**追加** 1 行 `净化 (0-100)`
- 不动其他位置

---

### 1.6 `high-key` preset 默认值微调（对比度提升）

用户原话："对比度也可以微调参数"。当前 high-key 还不够激进（mean≈100 的图出来仍偏暗）。

| field | 现 | 新 | 说明 |
|---|---|---|---|
| `contrast` | 40 | **55** | L1 传统参数微调（不可关） |
| `blackPoint` | 72 | **88** | L1 |
| `whitePoint` | 182 | **178** | L1 |
| `trimDark` | 65 | **75** | L1 |
| `feather` | 0 | **0** | 保持 dead；effective 值由 master 派生 |
| `purify`（新 master） | — | **50** | L2 新算法 SSOT（master=50 → effectiveFeather=12 等）|

**其他 3 个 preset 不动**（含 `feather: 0`、`purify: 0`）。

---

## 3. Part 2 — 手动选区圆滑

### 2.1 Centripetal Catmull-Rom 替换 Uniform

**问题**（`tracePolygonPath` `:90-109`）：当前用 uniform Catmull-Rom（每段参数化 t-间距恒为 1），公式 `cp1 = p1 + (p2-p0)*tension/6`。当某 handle 被拖远，`|p2-p0|` 模长爆炸 → cp 距 p1/p2 极远 → bezier 段冲出弧外形成 loop/尖刺（Image #5）。

**升级**：改用 **Centripetal Catmull-Rom**（α=0.5），切向量按 √(段长) 缩放，远段切向量不会爆炸 → **数学上保证不出现尖刺/loop**（Yuksel et al., 2011 证明）。

**公式**（cubic bezier 控制点形式）：
```
d01 = |p1-p0|, d12 = |p2-p1|, d23 = |p3-p2|
t01 = sqrt(d01), t12 = sqrt(d12), t23 = sqrt(d23)

// p1 处切向量（centripetal scaled）
m1 = ((p1-p0)/t01 - (p2-p0)/(t01+t12) + (p2-p1)/t12) * t12
// p2 处切向量
m2 = ((p2-p1)/t12 - (p3-p1)/(t12+t23) + (p3-p2)/t23) * t12

cp1 = p1 + m1 / 3
cp2 = p2 - m2 / 3
```

**边界**：若任意 d < 1e-6（两点重叠），降级用 uniform 公式（避免除零）。

**replace 范围**：`tracePolygonPath` 函数体（line 90-109），保持函数签名（caller 不改）。

**unit test 友好性**：写 1 个测试用例 — 36 点正方形 + 1 点拖到对角 → 验证生成路径不自交（用 polygon self-intersection 检测）。

---

### 2.2 拖动后局部平滑（pointer up 触发）

**问题**：即使用了 centripetal 不出 loop，**用户拖到突兀位置**仍会让局部曲线"硬转折"。Image #5 那种程度的尖刺会消失，但用户拖快、拖远时局部曲率仍可能不自然。

**升级**：`onOriginalPointerUp` 中（`:649-651`），对刚 dragged handle 及其前后 2 个邻居（共 5 个点）做**一次** 加权平均：

```
for i in [dragged-2, dragged-1, dragged, dragged+1, dragged+2]:
  if i == dragged: keep as-is（用户的意图最大化保留）
  else:
    neighbor_avg = (handles[i-1] + handles[i+1]) / 2
    handles[i] = handles[i] * 0.8 + neighbor_avg * 0.2  // 轻度
```

**说明**：
- `dragged` 本身**不动**（避免 "我拖到这里你又把我拉回去" 的反直觉）
- 只动前后各 2 个邻居，轻度（0.2 权重）
- 在闭合 polygon 上索引取模

**回退**：若用户不想要 → undo (Ctrl+Z) 即可（pointer up 后 pushHistory 已记录）。这个 smoothing pass 作为 pointer up 的一部分，**和拖动是一个 undo 步骤**（不需要拆 2 步撤销）。

**实现位置**：`onOriginalPointerUp` 内，在 `pushHistory(true)` 之前。

---

## 4. 数据结构变更

### `Params` 接口（`:67-76`）

```ts
interface Params {
  // 现有字段 — 全部保留，行为不变
  headExpand: number; foreheadExt: number; chinExt: number;
  feather: number;            // ← 现 dead，新启用（用于 1.1 边缘 falloff）
  alphaCut: number;
  trimDark: number; trimThr: number;
  autoNorm: boolean;
  blackPoint: number; whitePoint: number; gamma: number;
  contrast: number; edgeStrength: number; saturation: number;
  quantize: boolean; jpegLofi: boolean; jpegQ: number; blur: number;
  size: number;

  // 新增字段 — 默认 0，老 preset 全 0 → 行为不变
  purify?: number;            // 0-100, master slider
}
```

`purify` 用可选 + 在 processFace 入口 `const purify = params.purify ?? 0;` 容错。

### `PRESETS` 默认值

```ts
'ground-truth': { ..., feather: 0, purify: 0 },  // 不变（feather 继续 dead）
'high-key':     { ..., feather: 0, contrast: 55, blackPoint: 88, whitePoint: 178, trimDark: 75, purify: 50 },
'lofi':         { ..., feather: 0, purify: 0 },  // 不变
'hi-contrast':  { ..., feather: 0, purify: 0 },  // 不变
```

### Snapshot（undo/redo, `:404`）

无需改动 — snapshot 用 `{ ...params }` 复制整个 Params，新字段自动覆盖。

### autoRoute（`:175-195`）

无需改动 — 仍返回 preset key，applyPreset 走的还是 PRESETS 整体覆盖。

---

## 5. 测试 plan

### 5.1 Visual regression（手动 + dev 模式）

| 输入 | preset | 预期 |
|---|---|---|
| 用户给的张学友照 | `high-key`（默认） | face 干净度接近 Image #3，无边缘黑残痕 |
| 同上 | `ground-truth` | 与升级前**像素一致**（容差 0） |
| 同上 | `lofi` | 与升级前**像素一致** |
| 同上 | `hi-contrast` | 与升级前**像素一致** |
| 同上 | `high-key` + master=0 | 输出受 L1 微调影响（更亮更冲），但**无 4 个 L2 新 pass 痕迹**（edge falloff / luma-driven / mid fade / detail blur 全部 short-circuit） |

### 5.2 拖锚点

| 操作 | 预期 |
|---|---|
| 1 个 handle 拖到画面 50% 位置（远离邻居） | 不出现 loop / 尖刺 |
| 快速拖一圈所有 handle | 闭合曲线圆滑，无自交 |
| 拖完后立刻 Ctrl+Z | 完全恢复到拖之前状态（含 smoothing pass） |

### 5.3 性能

- 1024² 单图全 pipeline（master=50）耗时 < 200ms（rAF 一帧内可接受 16ms 的话就分到多帧，目前已经在 requestAnimationFrame 里）
- 多次拖锚 + 滑块变化无明显卡顿

### 5.4 兼容

- 旧的 localStorage 数据加载不破（新字段缺失 → undefined → fallback 0）
- TypeScript strict 编译通过
- 旧 preset 切换 → 立即看到旧效果（master=0）

---

## 6. 不做什么（划清 scope）

- ❌ **不**改交互范式（不引入 brush / lasso / quickmask 模式）
- ❌ **不**改 `tracePolygonPath` 签名（caller 不动）
- ❌ **不**改 advanced 区 UI（不暴露 4 个内部细参数 slider）
- ❌ **不**改 4 个现有 preset 名称 / 不删 preset
- ❌ **不**改 mediapipe landmarker / FACE_OVAL_INDICES 这层
- ❌ **不**改 composeMeme / pandacanvas（face PNG 输出格式不变）
- ❌ **不**改 `autoRoute` 路由逻辑（仍返回 4 个 preset 之一）
- ❌ **不**加新 preset（master slider 已经覆盖了"干净度"维度）

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Centripetal 公式实现错 → 曲线更糟 | 实现后用 5.2 的拖动测试 + 视觉对比；如果失败立刻 revert 这一处 |
| `high-key` 升级后部分照片"过曝"（whitePoint=178 太低） | master slider 拖低，或切到 `ground-truth` |
| box-blur 3-pass 性能不达标 | detailSuppress=0 时 short-circuit 跳过；若仍卡顿，downsample 到 512 算 blur 再 upsample |
| `feather` 在某些 preset 是 0（无效）vs 12（生效）的语义变化让用户混淆 | UI 不暴露 feather slider（保持在 advanced 里现状），用户感知不到 |
| 中心保护区半径 0.3 在长脸/方脸上覆盖不准 | 用 polygon 几何 center + 现有的 KP.TOP/CHIN 算法定的尺度 |

---

## 8. 文件清单

- **修改 2 个**：
  - `src/components/smartextractmodal.tsx` — 主战场（pipeline、PRESETS、UI、拖锚点）
  - `src/context/translations.ts` — 新增 1 个 i18n key `smartExtractPurify`（zh: "净化"，en: "Purify"）
- **不动**：`composeMeme.ts`、`pandacanvas.tsx`、`materials.ts`、`useLiveAnchor.ts`、所有 face/panda 数据文件

---

## 9. 实施顺序（写实施 plan 时拆 step）

按"风险低 → 风险高 + 独立可测"顺序：

0. **基建 — master 字段 + mapping**：Params 加 `purify?: number`，写 `deriveEffective(purify)` helper（输出 `{ feather, midToneFade, detailSuppress, darkenAlphaStrength, darkenLumThr }`），让后续 step 3-5 都消费 helper 而不是 Params 里的细字段（SSOT 永远是 master）
1. **2.1 Centripetal Catmull-Rom**：纯函数替换 `tracePolygonPath`，立即拖锚点验收
2. **2.2 拖动后局部平滑**：依赖 2.1，pointer up 加 5-tap weighted avg
3. **1.1 边缘 feather**：基于 step 0 的 effectiveFeather，新增 alpha falloff pass（master=0 短路）
4. **1.2 + 1.3 luma-driven + midtone fade**：同一 pixel loop（两个 pass 合一），含中心保护区
5. **1.4 edge-aware blur**：最大性能负担，单独验性能；effectiveDetailSuppress=0 时彻底短路（不算 std map）
6. **1.5 UI master slider + 1.6 PRESETS 默认值更新**：simple 区追加 1 个 slider 行；4 个 PRESETS 写入 `purify` 字段
7. **回归测试**：5.1 5.2 5.3 5.4 全跑

每步完成后 `bun run dev` 视觉验收，再进下一步。**step 1-5 实施期间 high-key preset 的 5 个 L1 字段还是旧值**（避免单步看到非预期变化）；step 6 才一并把 L1 旧值改成新值 + 加 master slider，一刀切到目标状态。

每步完成后跑一次 `bun run dev` 视觉验收，再进下一步。
