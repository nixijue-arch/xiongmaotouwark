// Animate 模板库 (DEV 工具 → 📋 模板库 → 保存到源文件 写入这里)
//
// 用法: 沙雕动画 ?page=animate → 编时间轴 → 顶栏 📋 模板库 → 保存当前 project 为模板
//     → Vite plugin /__sync/animate-templates 写到这里 → HMR reload, 其他人也能用
//
// 字段说明:
//   id      — 唯一 slug (kebab-case)
//   name    — 中文名
//   desc    — 一句话简介
//   tags    — 检索标签 (fomo/fud/roast/通用)
//   project — 完整 ProjectState 序列化 (含 clips/lanes/duration), audioSrc 已剥离
//
// 暂时为空, 等 DEV 在浏览器内保存模板后填充.

export interface AnimateTemplate {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  project: unknown; // ProjectState (avoid circular import — animatemode.tsx 用时 cast)
}

export const ANIMATE_TEMPLATES: AnimateTemplate[] = [];
