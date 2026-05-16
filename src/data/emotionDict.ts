// ============================================================
// AUTO-GENERATED — DO NOT EDIT MANUALLY
// Source:    netlify/functions/_lib/emotionDict.ts
// Regenerate: node scripts/sync-emotion-dict.mjs (or just 'bun run dev' / 'bun run build')
// ============================================================

// 情绪 / 动作 / 场景同义词字典 — 前后端共享 source of truth
// 后端 queryExpansion 用 EMOTION_DICT 做查询扩展
// 前端 chip 用 CHIP_DEFS 渲染情景标签
// 修改本文件后跑 `node scripts/sync-emotion-dict.mjs` 同步到 src/data/emotionDict.ts

export interface ChipDef {
  group: 'mood' | 'action';
  emoji: string;
  label: string;      // 显示文本 (中文, 也是字典的 key)
  terms: string[];    // 同义词数组, terms[0] 跟 label 同款
  featured?: boolean; // 前端 chip 行只显示 featured=true 的 (精选 12 个)
}

export const CHIP_DEFS: ChipDef[] = [
  // ===== mood (30) — featured 标记精选 ~12 个常用情绪/场景 =====
  { group: 'mood', emoji: '😊', label: '开心', terms: ['开心', '高兴', '快乐', '喜悦', '愉悦', '哈哈'], featured: true },
  { group: 'mood', emoji: '😭', label: '难过', terms: ['难过', '悲伤', '哭', '流泪', 'emo', '伤心'], featured: true },
  { group: 'mood', emoji: '🤬', label: '愤怒', terms: ['愤怒', '生气', '怒', '气', '怼', '骂'], featured: true },
  { group: 'mood', emoji: '😱', label: '震惊', terms: ['震惊', '吃惊', '惊讶', '卧槽', '问号', '啥'], featured: true },
  { group: 'mood', emoji: '🤔', label: '思考', terms: ['思考', '想', '困惑', '疑问', '思索'], featured: true },
  { group: 'mood', emoji: '😴', label: '困倦', terms: ['困', '累', '睡', '困倦', '疲惫'] },
  { group: 'mood', emoji: '😑', label: '无聊', terms: ['无聊', '没意思', '闲', '空虚', '发呆'] },
  { group: 'mood', emoji: '🥺', label: '委屈', terms: ['委屈', '可怜', '泪汪汪', '吃醋', '受伤'] },
  { group: 'mood', emoji: '😅', label: '尴尬', terms: ['尴尬', '冷场', '社死', '幻视', '抠脚趾'] },
  { group: 'mood', emoji: '😨', label: '害怕', terms: ['害怕', '恐惧', '吓', '怂', '怕'] },
  { group: 'mood', emoji: '🥹', label: '感动', terms: ['感动', '泪目', '感慨', '破防'] },
  { group: 'mood', emoji: '🍋', label: '嫉妒', terms: ['嫉妒', '羡慕', '柠檬精', '酸了'] },
  { group: 'mood', emoji: '😰', label: '紧张', terms: ['紧张', '冷汗', '心跳', '慌'] },
  { group: 'mood', emoji: '😌', label: '平静', terms: ['平静', '淡定', '佛系', '随缘', '从容'] },
  { group: 'mood', emoji: '🤩', label: '兴奋', terms: ['兴奋', '激动', '燃', '爆', '搞起来'] },
  { group: 'mood', emoji: '😮‍💨', label: '无奈', terms: ['无奈', '叹气', '行吧', '唉', '认输'] },
  { group: 'mood', emoji: '🙃', label: '嘲讽', terms: ['嘲讽', '阴阳', '反话', '酸', '哈哈'] },
  { group: 'mood', emoji: '😎', label: '得意', terms: ['得意', '骄傲', '嘚瑟', '飘', '小机灵鬼'] },
  { group: 'mood', emoji: '🙅', label: '拒绝', terms: ['拒绝', '不要', '不行', '不'] },
  { group: 'mood', emoji: '👍', label: '同意', terms: ['同意', '好', 'OK', '点头', '可以'] },
  { group: 'mood', emoji: '💀', label: '绝望', terms: ['绝望', '完了', '崩溃', '寄', '死了'] },
  { group: 'mood', emoji: '🤯', label: '崩溃', terms: ['崩溃', '抓狂', '疯', '癫', '炸毛'], featured: true },
  { group: 'mood', emoji: '🥰', label: '治愈', terms: ['治愈', '暖', '萌', '温暖'] },
  { group: 'mood', emoji: '💥', label: '暴怒', terms: ['暴怒', '炸', '爆炸', '气炸', '上头'] },
  { group: 'mood', emoji: '🎉', label: '狂喜', terms: ['狂喜', '飞起', '炸裂', '爽'], featured: true },
  { group: 'mood', emoji: '☕', label: '淡定', terms: ['淡定', '从容', '不慌', '稳'] },
  { group: 'mood', emoji: '🐶', label: '狗头', terms: ['狗头', '保命', '皮', '反讽'] },
  { group: 'mood', emoji: '🫥', label: '敷衍', terms: ['敷衍', '哦', '嗯嗯', '是吧', '随便'] },
  { group: 'mood', emoji: '🙏', label: '求饶', terms: ['求饶', '求求了', '饶命', '跪', '求'] },
  { group: 'mood', emoji: '😇', label: '装无辜', terms: ['装无辜', '我不是', '冤枉', '无辜', '不是我'] },

  // ===== action / scene (20) =====
  { group: 'action', emoji: '⚔️', label: '斗图', terms: ['斗图', 'meme', '互怼', '怼人', '挑衅'], featured: true },
  { group: 'action', emoji: '💼', label: '打工', terms: ['打工', '上班', '加班', '工作', '搬砖'] },
  { group: 'action', emoji: '🐟', label: '摸鱼', terms: ['摸鱼', '划水', '偷懒', '混'] },
  { group: 'action', emoji: '👔', label: '老板', terms: ['老板', 'boss', '领导', '甲方'] },
  { group: 'action', emoji: '📅', label: '周一', terms: ['周一', '上班日', '工作日', 'monday'] },
  { group: 'action', emoji: '💰', label: '工资', terms: ['工资', '钱', '薪水', '发钱'] },
  { group: 'action', emoji: '🏃', label: '裸辞', terms: ['裸辞', '辞职', '走人', '不干了', '老子不干了'] },
  { group: 'action', emoji: '🛌', label: '躺平', terms: ['躺平', '摆烂', '佛系', '咸鱼', '不想干'] },
  { group: 'action', emoji: '🌀', label: '内卷', terms: ['内卷', '卷', '比拼', '内耗'] },
  { group: 'action', emoji: '🥧', label: 'PUA', terms: ['PUA', '画饼', '洗脑', '忽悠'] },
  { group: 'action', emoji: '📊', label: '汇报', terms: ['汇报', '工作汇报', '报告', '述职'] },
  { group: 'action', emoji: '🪑', label: '会议', terms: ['会议', '开会', 'meeting', '开会咯'] },
  { group: 'action', emoji: '📉', label: '被裁', terms: ['被裁', '裁员', '下岗', '毕业'] },
  { group: 'action', emoji: '💸', label: '财务自由', terms: ['财务自由', '暴富', '中彩票', '发财', '一夜暴富'] },
  { group: 'action', emoji: '⚔️', label: '对线', terms: ['对线', '吵架', '吵', '撕', '怼'] },
  { group: 'action', emoji: '🍉', label: '吃瓜', terms: ['吃瓜', '看戏', '围观', '瓜'] },
  { group: 'action', emoji: '🆘', label: '求助', terms: ['求助', '帮忙', '求', '救命', '在线等'] },
  { group: 'action', emoji: '💔', label: '分手', terms: ['分手', '失恋', '前任', '感情破裂'] },
  { group: 'action', emoji: '🧧', label: '过年', terms: ['过年', '新年', '春节', '红包', '拜年'] },
  { group: 'action', emoji: '🎮', label: '打游戏', terms: ['打游戏', '游戏', '王者', 'LOL', '上分'] },
  { group: 'action', emoji: '🏋️', label: '减肥', terms: ['减肥', '健身', '运动', '瘦', '锻炼'] },
];

/** Derived: 后端 queryExpansion 用 — label → terms 映射 */
export const EMOTION_DICT: Record<string, string[]> = Object.fromEntries(
  CHIP_DEFS.map((c) => [c.label, c.terms]),
);
