// 全站统一表情包文案池 (contributed by PandaHead — github.com/jokkibtc/panda)
//
// 来源：
//   - pmw QuickMode 原版 30+18 经典熊猫头文案
//   - LittleRed 编辑器 RightSidebar 原版 90+ 网络流行语
// 合并后去重 + 移除 "Love 4 U" (用户反馈无梗感)
//
// QuickMode 与 编辑器"推荐文字"按钮 共享同一个池

export const RECOMMEND_TEXTS_ZH: string[] = [
  // pmw QuickMode 原版 (PandaHead) — 中文互联网经典熊猫头文案
  '我嘞个去', '你说得对', '禁止内卷', '求求了', '甲方又来了', '宝贝晚安', '周末摆烂',
  '再改一版', '哎呀压力大', '哈哈哈哈', '禁止加班', 'Pump it', 'we are so back',
  '做表情，不内卷', '笑死', '无语死了', '饿了', '下班', '不想动', '今天不想说话',
  '啊这', '好家伙', '牛批', '绝了', '破防了', '我没事', '我裂开了', '干嘛呢',
  '蚌埠住了', '栓Q',
  // LittleRed 编辑器原版 — 网络流行语
  '在？V我50', '我不做人啦！', '就这？', '你不对劲', '尊嘟假嘟', '这波在大气层',
  '笑死我了', '开始你的表演', '啊对对对', '我真的会谢', '无所谓我会出手',
  '这就是中国速度', '你在教我做事？', '问题不大', '我直接自信', '这很合理',
  '有内味了', '气氛到这了', '家人们谁懂啊', '这班不上也罢', '我说的是真的',
  '这就是格局', '我是废物', '太对了哥', '反杀反杀！', '？？？', '我先run了',
  '上班哪有不疯的', '这谁顶得住', '差不多得了', '这合理吗', '我已经报警了',
  '再装我就哭了', '不可能的', '你礼貌吗', '给跪了', '打工人打工魂', '开摆',
  '绷不住了', '汗流浃背了', '人间真实', '笑不活了', '6', '小丑竟是我自己',
  '速速撤退', '毁灭吧', '一键三连', '下次一定', '高产似那啥', 'cargo降落伞',
  '我太难了', '高手过招', '有点意思', '不太对劲', '这就是实力', '梦幻联动',
  '血赚', '亏麻了', '原地起飞', '给我整不会了', '离谱', '抽象', '狠狠拿捏了',
  '重拳出击', '纯路人', '理性讨论', '有一说一', '确实', '龟龟', '吓得我水都喷了',
  '很有精神', '一般般啦', '祖安钢琴家', '这波我必C', '你完了', '听我狡辩',
  '满脸写着开心', '为什么总是我', '麻了', '我悟了', '佛了', '杠精退散', '老实人',
  '正能量嗷', '格局打开', '毕竟我也不是什么恶魔', '说出来你可能不信',
  '此时一位靓仔路过', '先赌为敬', '重在参与', '赢了会所嫩模', '输了下海干活',
];

export const RECOMMEND_TEXTS_EN: string[] = [
  // pmw QuickMode 原版 (PandaHead) — meme English shorthand
  'no thoughts', 'send help', 'we so back', 'monday again', 'i am dead', 'fr fr',
  'say less', 'vibing', 'low key based', 'actually crying', 'this is fine', 'rip me',
  'deal with it', 'no cap', 'skill issue', 'touch grass', 'make memes not war',
  // LittleRed 编辑器原版 — meme catchphrases
  'V me 50 plz', 'I quit!', 'Really?', 'You sus', 'No cap fr fr', 'I cant even',
  'Big brain move', 'LMAO', 'Show me what you got', 'Yeah sure buddy', 'Im dead',
  'I got this', 'China speed', 'Oh no', 'You telling ME?', 'No problemo',
  'Straight up confident', 'Makes sense', 'Thats the vibe', 'It is what it is',
  'No shot', 'Thats crazy', 'Bet', 'Slay', 'I cant breathe', 'On god', 'Periodt',
  'Not even close', 'Im out', 'Ratio', 'Cooked', 'GG no re', 'Shaking rn', 'Bruh',
  'Who asked', 'Sir this is a Wendys', 'RIP', 'F in the chat', 'Just vibing',
  'Built different', 'Unhinged', 'Delulu', 'Main character energy', 'Rent free',
  'Gatekeeping', 'Understood the assignment', 'Thats suspicious', 'Its giving',
  'Yassified', 'Aesthetic', 'Sheesh', 'Bussin', 'Mid', 'Based', 'Cringe', 'Doomer',
  'Goblin mode', 'Rizz', 'GigaChad', 'Absolute cinema', 'Im cooked', 'Down bad',
  'W rizz', 'L take', 'NPC behavior', 'Caught in 4k', 'Hes so real',
  'Not the main character', 'Fumble', 'Down horrendous', 'Its joever', 'Mogging',
  'Looksmaxxing', 'Mewing', 'Edging', 'Ohio', 'Only in Ohio', 'Suiii',
  'What the sigma', 'Skibidi toilet', 'Gyatt', 'Mog or be mogged',
  'High value male', 'Sigma grindset', 'Top G', 'Wake up babe', 'New just dropped',
  'Fake it till you make it', 'Suffering from success', 'Another one', 'You smart',
  'You loyal', 'I appreciate you', 'Major key',
];

// 向后兼容：QuickMode 旧名继续 export, 都指向同一份合并库
export const RANDOM_TEXTS_ZH = RECOMMEND_TEXTS_ZH;
export const RANDOM_TEXTS_EN = RECOMMEND_TEXTS_EN;

export function pickRandomText(lang: 'zh' | 'en' | 'both', exclude?: string): string {
  let pool: string[];
  if (lang === 'zh') pool = RECOMMEND_TEXTS_ZH;
  else if (lang === 'en') pool = RECOMMEND_TEXTS_EN;
  else pool = [...RECOMMEND_TEXTS_ZH, ...RECOMMEND_TEXTS_EN];
  if (exclude) {
    const filtered = pool.filter((t) => t !== exclude);
    if (filtered.length) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
