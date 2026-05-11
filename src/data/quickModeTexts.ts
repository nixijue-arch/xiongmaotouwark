// QuickMode 一键随机文字池（contributed by PandaHead — github.com/jokkibtc/panda）
// 选自中文互联网经典熊猫头表情包文案

export const RANDOM_TEXTS_ZH: string[] = [
  "我嘞个去",
  "你说得对",
  "禁止内卷",
  "求求了",
  "甲方又来了",
  "宝贝晚安",
  "周末摆烂",
  "再改一版",
  "哎呀压力大",
  "哈哈哈哈",
  "禁止加班",
  "Pump it",
  "we are so back",
  "做表情，不内卷",
  "笑死",
  "无语死了",
  "饿了",
  "下班",
  "不想动",
  "今天不想说话",
  "啊这",
  "好家伙",
  "牛批",
  "绝了",
  "破防了",
  "我没事",
  "我裂开了",
  "干嘛呢",
  "蚌埠住了",
  "栓Q",
];

export const RANDOM_TEXTS_EN: string[] = [
  "Love 4 U",
  "no thoughts",
  "send help",
  "we so back",
  "monday again",
  "i am dead",
  "fr fr",
  "say less",
  "vibing",
  "low key based",
  "actually crying",
  "this is fine",
  "rip me",
  "deal with it",
  "no cap",
  "skill issue",
  "touch grass",
  "make memes not war",
];

export function pickRandomText(lang: 'zh' | 'en' | 'both', exclude?: string): string {
  let pool: string[];
  if (lang === 'zh') pool = RANDOM_TEXTS_ZH;
  else if (lang === 'en') pool = RANDOM_TEXTS_EN;
  else pool = [...RANDOM_TEXTS_ZH, ...RANDOM_TEXTS_EN];
  if (exclude) {
    const filtered = pool.filter((t) => t !== exclude);
    if (filtered.length) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
