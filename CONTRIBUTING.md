# 贡献指南

本仓库内置 3 个 **DEV-only** 本地工具（生产环境会被 tree-shake 完全剔除），让协作者直接在网页里改素材 / 文案 / 锚点，**不需要装任何额外脚本**。

## 一键启动

```bash
bun install   # 首次, 装依赖
bun run dev   # 起 vite, 默认 5173 (被占自动跳 3001 / 3002 ...)
```

启动后任何浏览器打开 `http://localhost:<port>/`，**顶栏 DEV 区**会多出 3 个**虚线边框按钮**：

| 按钮 | URL | 干啥的 |
|---|---|---|
| 🎯 **校准** | `?page=calibrate` | 拖锚点对齐 panda 跟 face |
| 📋 **素材** | `?page=materials` | 改 panda/face 中英文名 / 隐藏 / 打 mode tag |
| 📝 **文案** | `?page=captions` | 加 / 改 / 删 caption（含改源条目） |

生产网站（xiongmaotou.work）**永远看不到这三个按钮**，URL 直接访问也会跳回编辑器。

## 数据流：从本地编辑 → 永久入库

三个工具都用 **localStorage 暂存**，调好一批后点工具顶部 **"导出 TS code"** → 复制到剪贴板 → **粘到对应源文件** → 提 PR。

| 工具 | 暂存 localStorage key | 源文件（粘贴目标） |
|---|---|---|
| 校准 | `pmw-anchor-overrides-v1` | `src/data/panda-manual-overrides.ts` |
| 素材 | `pmw-material-meta-v1` | `src/data/material-meta-overrides.ts`（如不存在自行新建并 import） |
| 文案 | `pmw-caption-overrides-v1` + `pmw-caption-deleted-v1` | `src/data/quickModeTexts.ts` |

⚠️ **本地跟生产看起来不一致？** 你的浏览器 localStorage 里有 override，生产看不到。开校准页/素材页/文案页点 **"清空全部"** 即可回到源数据状态。

---

## 📝 文案库贡献（最常见）

90% 贡献是补 caption。**两种方式：**

### 极简流程（推荐 — 一键写文件，零 copy-paste）

1. `bun run dev` → 顶栏点 📝 **文案**
2. 在 UI 里加 / 改 / 删 caption（所有改动暂存 localStorage）
3. 点顶部绿色按钮 **💾 保存到源文件** → 自动写入 `src/data/quickModeTexts.ts`
   - 走本地 Vite 插件（`/__sync/captions` 端点），**只在 dev 模式可用**，prod 无效（plugin `apply: 'serve'` + Netlify 静态托管无 Node 中间件）
   - 写完自动清 localStorage（本地 state 已完全落到源文件）
   - Vite HMR 自动 reload，立即看到新源池
4. `git add src/data/quickModeTexts.ts && git commit -m "feat: 补 N 条 X 模式文案" && git push`
5. 提 PR

**没有第二步 copy-paste**。点按钮 → git commit → 完事。

### Fallback：clipboard 复制（plugin 没起来时自动走）

如果第 3 步 fetch 失败（plugin 没注册 / 端口冲突 / 其他原因），按钮会自动走老路径：复制完整源到剪贴板，让你手动粘到 `quickModeTexts.ts`。toast 会提示。

### 方式 B：直接改源文件（适合一次加大量）

打开 `src/data/quickModeTexts.ts`：

```ts
export const TEXTS_ZH: ModedText[] = [
  // 现有...
  { text: '你的新文案', tags: ['roast'] },          // ← 加这一行
  { text: '另一条', tags: ['fud', 'roast'] },       // ← 跨模式用数组
];

export const TEXTS_EN: ModedText[] = [
  // 现有...
  { text: 'your new caption', tags: ['fomo'] },     // ← 加这一行
];
```

**Tags 取值**（只有 3 个有效）：`'fomo'` / `'fud'` / `'roast'`。一条 caption 可属多模式（数组里多个 tag），DEV / prod 抽签会自动按 tag 过滤池。

### 文案库**完全覆盖**模式（重要）

PR 合并后，新版 `quickModeTexts.ts` **完全覆盖**线上随机文案池。线上 localStorage 里用户加的不会影响其他人，但合并到源的会全员生效。生产 build 时所有 DEV-only 用户加/删功能都不参与（用户那台浏览器的 localStorage 也不被生产代码读取）。

---

## 📋 素材库贡献

同流程：📋 **素材** → 改 labelCn/labelEn / 打 tag / 隐藏 → 导出 TS code → 粘到 `src/data/material-meta-overrides.ts`。

**素材本身不可删除**（防失误）。"删除" 按钮 = 屏蔽（用户端 picker 不显示），仍可"取消屏蔽"恢复。

---

## 🎯 校准贡献

详见 [CALIBRATE_GUIDE.md](./CALIBRATE_GUIDE.md)。

简版：拖锚点 → 导出 → 粘到 `src/data/panda-manual-overrides.ts`。

---

## 命名 / 提 PR

```bash
git checkout -b feat/captions-batch-N      # 文案批次
# 或 feat/calibrate-pandas-XYZ              # 校准
# 或 feat/material-tags-XYZ                 # 素材

git add src/data/quickModeTexts.ts          # 改了什么就 add 什么
git commit -m "feat: 加 N 条 FOMO 文案 (粘自 文案管理导出)"
git push origin <branch>
gh pr create --base main                    # 或网页发 PR
```

## 安全

三个工具 **三层防御** 阻止进入生产：

1. **Header 入口** `import.meta.env.DEV` 包裹 → prod render 拦截
2. **路由 / URL 参数** `import.meta.env.DEV` 包裹 → URL 注入无效
3. **页面组件** 顶部 `if (!DEV) return fallback` → 即使越过路由也只看到提示

生产 build 验证：
```bash
bun run build
grep -c "MaterialManage\|CaptionManage\|CalibrateAnchor" dist/assets/*.js
# 期望: 0 (代码完全 tree-shake)
```

用户哪怕 DevTools 改 localStorage，生产代码也**完全不读**这些 key（pickRandomText 里 `import.meta.env.DEV` 双重 gate）。
