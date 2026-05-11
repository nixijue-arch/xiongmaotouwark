# 表情对齐工具使用说明

把每个 panda shell 的 face 锚点（位置 + 大小 + 五官饱满度）肉眼校准到位的本地小工具。仅 **DEV 模式** 可用，生产构建会被 tree-shake 掉。

## 启动

| 平台 | 命令 |
|---|---|
| **Windows** | 双击 `dev-calibrate.bat` |
| **macOS / Linux** | 终端执行 `./dev-calibrate.sh`（首次需 `chmod +x dev-calibrate.sh`） |
| **手动** | `bun x vite --port 5173 --strictPort`，然后开 http://localhost:5173/?page=calibrate |

启动后浏览器自动打开校准页（6 秒延迟等 vite 起服务）。

## 工作流

1. 左侧选 panda（已校准的右边有橙色 ● 点）
2. 预览图上 **拖橙色椭圆** 移动锚点；**拉 4 个角** 缩放
3. 右侧 **数值框** 精调 x/y/w/h；**faceFill** 滑块调五官填满度（0.7~1.1）
4. 所有改动 **自动保存** 到浏览器 localStorage（仅本机预览有效）
5. 调好一批后点 **"导出 TS code"**，自动复制到剪贴板
6. 粘贴到 `src/data/panda-manual-overrides.ts`，下次构建对全部用户生效

## 键盘快捷键

| 键 | 作用 |
|---|---|
| `← →` | anchor 平移 1px |
| `Shift + ← →` / `↑ ↓` | 大幅平移（10px / 1px Y 轴） |
| `Alt + ← →` | 切换上一个 / 下一个 panda |
| `R` | 重置当前 panda 到默认 |
| `Ctrl + Z` / `Ctrl + Shift + Z` | 撤销 / 重做 |
| `Esc` | 返回 |

## 三套坐标系

工具在 3 个坐标系之间换算（与 `composeMeme.ts` 完全一致）：

```
350-coord (faceOffset 存储用)
  ↓  ÷ scale_orig (= min(350/NW, 350/NH))
native pixel (panda PNG 原始像素)
  ↓  − bbox 左上 + × outScale
cropped canvas (composeMeme 输出画布，已去 whitespace padding)
```

拖拽时反向：屏幕像素 → cropped canvas → native → 350-coord，最后存 `faceOffset` 字段。

## 持久化

- localStorage key: `pmw-anchor-overrides-v1`
- 格式: `{ "panda-01": { faceOffset: {x,y,w,h}, faceFill: 0.95, ts: 1234... } }`
- 清空: 工具内"清空全部"按钮，或浏览器 devtools 删 localStorage 项

## 防误进

校准工具 **仅 DEV mode 渲染**：
- `Header` 按钮用 `import.meta.env.DEV && (...)` 包裹 → 生产看不到
- `CalibrateAnchor` 组件顶部 `if (!DEV) return fallback` → 即使 URL 注入也只看到提示
- 生产 build 校验：`bun run build && grep -c "saveAnchorOverride" dist/assets/*.js` 应为 0

## 提交校准结果

```bash
# 调好一批后
git add src/data/panda-manual-overrides.ts
git commit -m "校准 N 个 shell 锚点"
```

`panda-manual-overrides.ts` 是数据文件，PR diff 干净直观。
