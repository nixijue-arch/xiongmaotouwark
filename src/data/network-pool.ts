// 联网搜表情包 — DEV 沉淀的本地素材池
// 用户在前端 ⭐ 沉淀按钮 → vite-plugin-network-pool-sync 写盘 → append 到本文件
// HMR 自动 reload 后 ALL_PANDAS / ALL_FACES (materials.ts) 自动包含新条目
//
// 本文件由 DEV 工具维护, 但可以手动改 (改完跑 dev/build 都安全)
// 部分字段 (id/src) 需要保持 vite-plugin-network-pool-sync.ts 约定的格式

import type { Material } from './materials';

/** 沉淀的 panda 类素材 — merge 进 ALL_PANDAS */
export const NETWORK_PANDAS: Material[] = [
];

/** 沉淀的 face 类素材 — merge 进 ALL_FACES */
export const NETWORK_FACES: Material[] = [
];

/** 沉淀的 scene 类素材 — 沙雕动画用 (后续接入) */
export const NETWORK_SCENES: Material[] = [
];
