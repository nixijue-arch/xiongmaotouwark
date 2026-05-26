// 全站统一表情包文案池 (contributed by PandaHead — github.com/jsybtc/panda)
//
// ============== 协作者快速上手 ==============
// 推荐: 浏览器跑 DEV 文案管理 (顶栏 📝 文案) → 加/改/删 caption → 点 "💾 保存到源文件"
//      → Vite 插件自动写这里, git commit + push 即可. 见 ./CONTRIBUTING.md
//
// 或直接改这两个数组, 加一行:
//   { text: '你的新文案', tags: ['roast'] }
//
// tags 取值 (只有 3 个有效):
//   'fomo'  — 冲 / 牛 / 上车 / 革命
//   'fud'   — 砸 / 归零 / 退钱 / RNM / jeet 骚扰
//   'roast' — 斗图 / 互喷 / 抽象 / 药水哥 / 网络梗
//
// 跨模式: tags 数组放多个, 例 ['roast', 'fud'].
//
// ============== 历史 ==============
// v5 (2026-05-12): 合并 abstract → roast 一个 "斗图" 大类
//   - 3 mode: fomo / fud / roast (斗图含原抽象池)
//   - 10 次不重复机制 (recent-10 history per lang)
//   - runtime dedup by text
//   - EN 池真做 (annoyingjeetpack 风 jeet 骚扰 + 真 CT bullish + 4chan/TikTok roast)
//   - DEV-only 用户加 / 删源 通过 localStorage 实时合入 pickRandomText, 不影响 prod

export type Mode = 'fomo' | 'fud' | 'roast';
export const ALL_MODES: Mode[] = ['fomo', 'fud', 'roast'];

export interface ModedText {
  text: string;
  tags: Mode[];
}

// ============ 中文 ============

export const TEXTS_ZH: ModedText[] = [
  { text: '我要打十个', tags: ['roast'] },
  { text: '跟人沾边的事你是一点也不干', tags: ['roast'] },
  { text: '宁配吗', tags: ['roast'] },
  { text: '给你一脚', tags: ['roast'] },
  { text: '好图 我收下了', tags: ['roast'] },
  { text: '年轻人不讲武德', tags: ['roast'] },
  { text: '滚开 盗图狗', tags: ['roast'] },
  { text: '你敢与我作对吗', tags: ['roast'] },
  { text: '给爷整笑了', tags: ['roast'] },
  { text: '我早已麻痹', tags: ['roast'] },
  { text: '你看 又急', tags: ['roast'] },
  { text: '你已急哭', tags: ['roast'] },
  { text: '菜就多练', tags: ['roast'] },
  { text: '回答我！', tags: ['roast'] },
  { text: '如何呢？', tags: ['roast'] },
  { text: '那咋了', tags: ['roast'] },
  { text: '真得控制你了', tags: ['roast'] },
  { text: '爸爸的事你少管', tags: ['roast'] },
  { text: '我要是不呢', tags: ['roast'] },
  { text: '你在教我做事？', tags: ['roast'] },
  { text: '无人懂朕的忧伤', tags: ['roast'] },
  { text: '你先别急', tags: ['roast'] },
  { text: '已老实', tags: ['roast'] },
  { text: '雀食牛批', tags: ['roast'] },
  { text: '那又怎样 打死我？', tags: ['roast'] },
  { text: '你们不要再打了', tags: ['roast'] },
  { text: '没人比我更懂斗图', tags: ['roast'] },
  { text: '鉴定为典', tags: ['roast'] },
  { text: '鉴定完毕 你菜', tags: ['roast'] },
  { text: '谁给你的勇气？', tags: ['roast'] },
  { text: '给朕跪安吧', tags: ['roast'] },
  { text: '该说不说 讲究', tags: ['roast'] },
  { text: '家人们谁懂啊', tags: ['roast'] },
  { text: '你好骚啊', tags: ['roast'] },
  { text: '听我说谢谢你', tags: ['roast'] },
  { text: '什么都冲只会害了你', tags: ['roast', 'fud'] },
  { text: '这是个好事儿啊', tags: ['roast'] },
  { text: '把保护打在公屏上', tags: ['roast'] },
  { text: '笑不活了', tags: ['roast'] },
  { text: '真的会谢', tags: ['roast'] },
  { text: '已读乱回', tags: ['roast'] },
  { text: '鼠鼠我啊', tags: ['roast'] },
  { text: '嘉豪行为', tags: ['roast'] },
  { text: '完辣', tags: ['roast'] },
  { text: 'oi 火热起来了', tags: ['roast'] },
  { text: '我 Chovy', tags: ['roast'] },
  { text: '包的', tags: ['roast'] },
  { text: '一眼丁真', tags: ['roast'] },
  { text: '芭比Q了', tags: ['roast'] },
  { text: '你个老6', tags: ['roast'] },
  { text: '我要验牌', tags: ['roast', 'fud'] },
  { text: '受着呗', tags: ['roast'] },
  { text: '来财', tags: ['roast', 'fomo'] },
  { text: '小鸟伏特加', tags: ['roast'] },
  { text: '死鬼', tags: ['roast'] },
  { text: '双手点赞', tags: ['roast'] },
  { text: '已老实求放过', tags: ['roast'] },
  { text: '越努力越搞笑', tags: ['roast'] },
  { text: '人人都欺负我偏偏我也最好欺负', tags: ['roast'] },
  { text: '离了个特朗普', tags: ['roast'] },
  { text: '人不能， 至少不应该', tags: ['roast'] },
  { text: '带带弟弟', tags: ['roast'] },
  { text: '太带派了', tags: ['roast'] },
  { text: '歪比巴卜', tags: ['roast'] },
  { text: '我真没招了', tags: ['roast'] },
  { text: '小丑竟是我自己', tags: ['roast'] },
  { text: '尊嘟假嘟', tags: ['roast'] },
  { text: '两眼一闭 终于死了', tags: ['roast'] },
  { text: '机构进场了', tags: ['fomo'] },
  { text: '区块链革命', tags: ['fomo'] },
  { text: 'To The Moon', tags: ['fomo'] },
  { text: '币安思维', tags: ['fomo'] },
  { text: '格局打开', tags: ['fomo'] },
  { text: '赢麻了', tags: ['fomo'] },
  { text: '梭哈', tags: ['fomo'] },
  { text: 'ALL IN', tags: ['fomo'] },
  { text: '百倍起步', tags: ['fomo'] },
  { text: '逆天改命', tags: ['fomo'] },
  { text: '拉爆空头', tags: ['fomo'] },
  { text: '这次不一样', tags: ['fomo'] },
  { text: '赢了会所嫩模', tags: ['fomo'] },
  { text: '有劲有劲有劲', tags: ['fomo'] },
  { text: '起飞', tags: ['fomo'] },
  { text: '牛回速归', tags: ['fomo'] },
  { text: '冲鸭', tags: ['fomo'] },
  { text: '包赔的兄弟', tags: ['fomo'] },
  { text: '没时间解释了', tags: ['fomo'] },
  { text: '大展宏图', tags: ['fomo'] },
  { text: '爆炒', tags: ['fomo'] },
  { text: '做大 做强', tags: ['fomo'] },
  { text: '冲杀干！！', tags: ['fomo'] },
  { text: 'gake正在查看叙事', tags: ['fomo'] },
  { text: '王小二正在打开gmgn', tags: ['fomo'] },
  { text: '冷静正在提币', tags: ['fomo'] },
  { text: '主力球员正在开机', tags: ['fomo'] },
  { text: '猴哥在猛干', tags: ['fomo'] },
  { text: 'Next Bome', tags: ['fomo'] },
  { text: '发财了兄弟', tags: ['fomo'] },
  { text: '单币1M', tags: ['fomo'] },
  { text: '区块链骗局', tags: ['fud'] },
  { text: 'RNM 退钱', tags: ['fud'] },
  { text: '亏麻了', tags: ['fud'] },
  { text: '丸辣', tags: ['fud'] },
  { text: '次次都一样', tags: ['fud'] },
  { text: '貔貅我日', tags: ['fud'] },
  { text: '输了下海干活', tags: ['fud'] },
  { text: '我钱呢', tags: ['fud'] },
  { text: '完了芭比Q了', tags: ['fud'] },
  { text: '浇给', tags: ['fud'] },
  { text: 'p不动了', tags: ['fud'] },
  { text: '么有，太贵了', tags: ['fud'] },
  { text: '我要维权！', tags: ['fud'] },
  { text: '我池子呢', tags: ['fud'] },
  { text: '这场盛宴又是我买单', tags: ['fud'] },
  { text: '爱消费的穷人路过', tags: ['roast'] },
  { text: '遇到难回答的问题又不说话了', tags: ['roast'] },
  { text: '我现在去死你满意了吗', tags: ['roast'] },
  { text: '我chovy 你们都干嘛呢', tags: ['roast'] },
  { text: '舒服了', tags: ['roast', 'fomo'] },
  { text: '你们发CA给我发好的啊', tags: ['fud', 'roast', 'fomo'] },
  { text: '勇敢牛牛不怕困难', tags: ['roast', 'fomo'] },
  { text: '你不是我们的兄弟\n你是路人', tags: ['roast'] },
  { text: '救命', tags: ['fud'] },
  { text: '我受不了网络暴力', tags: ['roast'] },
  { text: '何意味', tags: ['roast'] },
  { text: '我踏马来了', tags: ['fomo', 'roast'] },
  { text: '顶尖', tags: ['fomo', 'roast'] },
  { text: '无敌', tags: ['fomo'] },
  { text: '我人傻了', tags: ['roast'] },
  { text: '冲啊冲啊！', tags: ['fomo'] },
  { text: '爆！', tags: ['fomo'] },
  { text: '跑！', tags: ['fud'] },
  { text: '夯爆了', tags: ['fomo'] },
  { text: '拉完了', tags: ['fud'] },
  { text: '重在掺和', tags: ['fomo', 'roast'] },
  { text: '你是来拉屎的吧', tags: ['roast'] },
  { text: '别研究太细\n跟着炒就行', tags: ['fomo'] },
  { text: '高人在包间', tags: ['fomo', 'roast'] },
  { text: '芜湖起飞', tags: ['fomo', 'roast'] },
  { text: '梭进去死了算了', tags: ['fomo'] },
  { text: '先信资本', tags: ['fomo'] },
  { text: '山顶资本', tags: ['fud'] },
  { text: '拿去花吧 别烦我', tags: ['roast'] },
  { text: '我发现了金狗', tags: ['fomo'] },
  { text: '不要对长期的涨幅\n缺乏想象', tags: ['fomo'] },
  { text: '伟大！', tags: ['fomo'] },
  { text: '人只活一次', tags: ['fomo'] },
  { text: 'WDNMD', tags: ['roast'] },
  { text: '别砸了求你了', tags: ['fud'] },
];

// ============ 英文 ============
// v5 真做 — annoyingjeetpack 风格 (slash commands + dev/admin 骚扰 + 自嘲) +
//         真 CT bullish FOMO + 4chan/TikTok 互喷 roast

export const TEXTS_EN: ModedText[] = [
  { text: '/site', tags: ['fud'] },
  { text: 'site??', tags: ['fud'] },
  { text: 'SITE???', tags: ['fud'] },
  { text: '/website', tags: ['fud'] },
  { text: 'website???', tags: ['fud'] },
  { text: '/contract', tags: ['fud'] },
  { text: '/tax', tags: ['fud'] },
  { text: '/admins', tags: ['fud'] },
  { text: '/admin', tags: ['fud'] },
  { text: '/chart', tags: ['fud'] },
  { text: '/tg', tags: ['fud'] },
  { text: '/twitter', tags: ['fud'] },
  { text: '/buybot offline', tags: ['fud'] },
  { text: '/pinned where', tags: ['fud'] },
  { text: 'dev?', tags: ['fud'] },
  { text: 'dev??', tags: ['fud'] },
  { text: 'dev???', tags: ['fud'] },
  { text: 'dev are you there', tags: ['fud'] },
  { text: 'dev are you there???', tags: ['fud'] },
  { text: 'dev dm', tags: ['fud'] },
  { text: 'dev wake up', tags: ['fud'] },
  { text: 'dev sold', tags: ['fud'] },
  { text: 'dev rugged us', tags: ['fud'] },
  { text: 'where is dev', tags: ['fud'] },
  { text: 'where the dev at', tags: ['fud'] },
  { text: 'where r u dev', tags: ['fud'] },
  { text: 'when are u back dev', tags: ['fud'] },
  { text: 'hello?', tags: ['fud'] },
  { text: 'hello??', tags: ['fud'] },
  { text: 'hello i need to speak with dev', tags: ['fud'] },
  { text: 'any plans?', tags: ['fud'] },
  { text: 'any plans???', tags: ['fud'] },
  { text: 'renounce??', tags: ['fud'] },
  { text: 'when renounce', tags: ['fud'] },
  { text: 'when renounce ser', tags: ['fud'] },
  { text: 'team here?', tags: ['fud'] },
  { text: 'team here???', tags: ['fud'] },
  { text: 'where is team', tags: ['fud'] },
  { text: 'utility?', tags: ['fud'] },
  { text: 'utility???', tags: ['fud'] },
  { text: 'what is this?', tags: ['fud'] },
  { text: 'what is this token about?', tags: ['fud'] },
  { text: 'who can i dm', tags: ['fud'] },
  { text: 'who can i dm about marketing', tags: ['fud'] },
  { text: 'marketing??', tags: ['fud'] },
  { text: 'marketing???', tags: ['fud'] },
  { text: 'marketing dead', tags: ['fud'] },
  { text: 'when marketing', tags: ['fud'] },
  { text: '1...2...3... raid!!!', tags: ['fud'] },
  { text: 'tag me as raidleader', tags: ['fud'] },
  { text: 'raidleader pls', tags: ['fud'] },
  { text: 'pls raidleader', tags: ['fud'] },
  { text: 'pls promote', tags: ['fud'] },
  { text: 'pls pin', tags: ['fud'] },
  { text: 'pls mute the fud', tags: ['fud'] },
  { text: 'any previous projects?', tags: ['fud'] },
  { text: 'doxxed?', tags: ['fud'] },
  { text: 'when doxx', tags: ['fud'] },
  { text: 'gem??', tags: ['fud'] },
  { text: 'gem pls', tags: ['fud'] },
  { text: 'top holders?', tags: ['fud'] },
  { text: 'whale dumping', tags: ['fud'] },
  { text: 'snipers won', tags: ['fud'] },
  { text: 'bots dumped', tags: ['fud'] },
  { text: 'listed binance?', tags: ['fud'] },
  { text: 'when binance', tags: ['fud'] },
  { text: 'when cex', tags: ['fud'] },
  { text: 'when listing', tags: ['fud'] },
  { text: 'volume dead', tags: ['fud'] },
  { text: 'price stuck', tags: ['fud'] },
  { text: 'price stuck wtf', tags: ['fud'] },
  { text: 'lp locked?', tags: ['fud'] },
  { text: 'when burn', tags: ['fud'] },
  { text: 'when audit', tags: ['fud'] },
  { text: 'audit pls', tags: ['fud'] },
  { text: 'chart cooked', tags: ['fud'] },
  { text: 'chart joever', tags: ['fud'] },
  { text: 'support broken', tags: ['fud'] },
  { text: 'i fud my own bags', tags: ['fud'] },
  { text: 'even though im holding i fud my own bags', tags: ['fud'] },
  { text: 'bagholding cope', tags: ['fud'] },
  { text: 'i held i lost', tags: ['fud'] },
  { text: 'i hodled and lost', tags: ['fud'] },
  { text: 'i bought top sold bottom', tags: ['fud', 'roast'] },
  { text: 'i bought then it dumped', tags: ['fud'] },
  { text: 'i sold then it pumped', tags: ['fud'] },
  { text: 'rugged', tags: ['fud'] },
  { text: 'rugged ser', tags: ['fud'] },
  { text: 'rugged hard', tags: ['fud'] },
  { text: 'got rugged', tags: ['fud'] },
  { text: 'got rekt', tags: ['fud'] },
  { text: 'rip my bag', tags: ['fud'] },
  { text: 'rip ser', tags: ['fud'] },
  { text: 'its joever', tags: ['fud'] },
  { text: 'its over', tags: ['fud'] },
  { text: 'were so cooked', tags: ['fud'] },
  { text: 'down bad', tags: ['fud'] },
  { text: 'down only', tags: ['fud'] },
  { text: 'paper hands', tags: ['fud'] },
  { text: 'ngmi', tags: ['fud', 'roast'] },
  { text: 'ngmi ser', tags: ['fud', 'roast'] },
  { text: 'send help', tags: ['fud'] },
  { text: 'im cooked', tags: ['fud'] },
  { text: 'im so cooked', tags: ['fud'] },
  { text: 'wen recovery', tags: ['fud'] },
  { text: 'its dust', tags: ['fud'] },
  { text: 'its dead', tags: ['fud'] },
  { text: 'dead chain', tags: ['fud'] },
  { text: 'zerod', tags: ['fud'] },
  { text: 'exit liquidity', tags: ['fud'] },
  { text: 'bear porn', tags: ['fud'] },
  { text: 'cant cope', tags: ['fud'] },
  { text: 'all gone', tags: ['fud'] },
  { text: 'dump only', tags: ['fud'] },
  { text: 'wen pump tho', tags: ['fud'] },
  { text: 'holdcels', tags: ['fud'] },
  { text: 'another rug', tags: ['fud'] },
  { text: 'another shitcoin', tags: ['fud'] },
  { text: 'shitcoin season', tags: ['fud'] },
  { text: 'delete wallet', tags: ['fud'] },
  { text: 'uninstall metamask', tags: ['fud'] },
  { text: 'im done', tags: ['fud'] },
  { text: 'never again', tags: ['fud'] },
  { text: 'lost it all', tags: ['fud'] },
  { text: 'give me my money back', tags: ['fud'] },
  { text: 'refund pls', tags: ['fud'] },
  { text: 'i want a refund', tags: ['fud'] },
  { text: 'scam project', tags: ['fud'] },
  { text: 'ponzi scheme', tags: ['fud'] },
  { text: 'ponzi confirmed', tags: ['fud'] },
  { text: 'dev rug', tags: ['fud'] },
  { text: 'dev rugged', tags: ['fud'] },
  { text: '100% rug', tags: ['fud'] },
  { text: 'its a scam', tags: ['fud'] },
  { text: 'its a rug', tags: ['fud'] },
  { text: 'we eat dirt', tags: ['fud'] },
  { text: 'bag holding', tags: ['fud'] },
  { text: 'bag holder', tags: ['fud'] },
  { text: 'lfg', tags: ['fomo'] },
  { text: 'lfg fam', tags: ['fomo'] },
  { text: 'lfg bro', tags: ['fomo'] },
  { text: 'lfg ser', tags: ['fomo'] },
  { text: 'lfgggg', tags: ['fomo'] },
  { text: 'lets fucking go', tags: ['fomo'] },
  { text: 'lets goooo', tags: ['fomo'] },
  { text: 'to the moon', tags: ['fomo'] },
  { text: 'moon bound', tags: ['fomo'] },
  { text: 'moon mission', tags: ['fomo'] },
  { text: 'moon soon', tags: ['fomo'] },
  { text: 'mooning rn', tags: ['fomo'] },
  { text: 'mooning hard', tags: ['fomo'] },
  { text: 'send it', tags: ['fomo'] },
  { text: 'send it ser', tags: ['fomo'] },
  { text: 'send it bro', tags: ['fomo'] },
  { text: 'send it harder', tags: ['fomo'] },
  { text: 'send it like elon', tags: ['fomo'] },
  { text: 'all in', tags: ['fomo'] },
  { text: 'all in already', tags: ['fomo'] },
  { text: 'pump it', tags: ['fomo'] },
  { text: 'pump it harder', tags: ['fomo'] },
  { text: 'ape in', tags: ['fomo'] },
  { text: 'ape it', tags: ['fomo'] },
  { text: 'ape ape ape', tags: ['fomo'] },
  { text: 'aping in', tags: ['fomo'] },
  { text: 'aped in', tags: ['fomo'] },
  { text: 'buy now', tags: ['fomo'] },
  { text: 'buy buy buy', tags: ['fomo'] },
  { text: 'just buy', tags: ['fomo'] },
  { text: 'just buy bro', tags: ['fomo'] },
  { text: 'dont sleep', tags: ['fomo'] },
  { text: 'dont sleep on this', tags: ['fomo'] },
  { text: 'last chance', tags: ['fomo'] },
  { text: 'last chance fr', tags: ['fomo'] },
  { text: 'up only', tags: ['fomo'] },
  { text: 'up only ser', tags: ['fomo'] },
  { text: 'up only fr', tags: ['fomo'] },
  { text: 'number go up', tags: ['fomo'] },
  { text: 'ngu', tags: ['fomo'] },
  { text: 'ngu only', tags: ['fomo'] },
  { text: 'wagmi', tags: ['fomo'] },
  { text: 'wagmi bro', tags: ['fomo'] },
  { text: 'wagmi fam', tags: ['fomo'] },
  { text: 'wagmi fren', tags: ['fomo'] },
  { text: 'wgmi', tags: ['fomo'] },
  { text: 'this is the way', tags: ['fomo'] },
  { text: 'bullish', tags: ['fomo'] },
  { text: 'bullish af', tags: ['fomo'] },
  { text: 'bullish on this', tags: ['fomo'] },
  { text: 'giga bull', tags: ['fomo'] },
  { text: 'mega bull', tags: ['fomo'] },
  { text: 'wen lambo', tags: ['fomo'] },
  { text: 'wen moon', tags: ['fomo'] },
  { text: 'wen pump', tags: ['fomo'] },
  { text: 'wen 10x', tags: ['fomo'] },
  { text: 'wen 100x', tags: ['fomo'] },
  { text: 'wen 1000x', tags: ['fomo'] },
  { text: 'yolo time', tags: ['fomo'] },
  { text: 'yolod', tags: ['fomo'] },
  { text: 'fomo in', tags: ['fomo'] },
  { text: 'fomo speed', tags: ['fomo'] },
  { text: 'lock in', tags: ['fomo'] },
  { text: 'locked in', tags: ['fomo'] },
  { text: 'btfd', tags: ['fomo'] },
  { text: 'btfd ser', tags: ['fomo'] },
  { text: 'btd hard', tags: ['fomo'] },
  { text: 'just hodl', tags: ['fomo'] },
  { text: 'hodl forever', tags: ['fomo'] },
  { text: 'diamond hands forever', tags: ['fomo'] },
  { text: 'we so early', tags: ['fomo'] },
  { text: 'still early', tags: ['fomo'] },
  { text: 'super early', tags: ['fomo'] },
  { text: 'we eatin good', tags: ['fomo'] },
  { text: 'we feastin', tags: ['fomo'] },
  { text: 'gm anon', tags: ['fomo'] },
  { text: 'gm ser', tags: ['fomo'] },
  { text: 'gm fren', tags: ['fomo'] },
  { text: 'gm fam', tags: ['fomo'] },
  { text: 'next pepe', tags: ['fomo'] },
  { text: 'next 100x', tags: ['fomo'] },
  { text: 'ape and pray', tags: ['fomo'] },
  { text: 'inverse jeets', tags: ['fomo'] },
  { text: 'inverse the fud', tags: ['fomo'] },
  { text: 'jeets cope', tags: ['fomo', 'roast'] },
  { text: 'chads buy', tags: ['fomo'] },
  { text: 'chads holding', tags: ['fomo'] },
  { text: 'chad pilled', tags: ['fomo'] },
  { text: 'based and bullpilled', tags: ['fomo'] },
  { text: 'buying the dip', tags: ['fomo'] },
  { text: 'buy the dip', tags: ['fomo'] },
  { text: 'buy the dump', tags: ['fomo'] },
  { text: 'bottom is in', tags: ['fomo'] },
  { text: 'floor confirmed', tags: ['fomo'] },
  { text: 'floor is in', tags: ['fomo'] },
  { text: 'support held', tags: ['fomo'] },
  { text: 'breakout incoming', tags: ['fomo'] },
  { text: 'god candle', tags: ['fomo'] },
  { text: 'godcandle', tags: ['fomo'] },
  { text: 'green candles', tags: ['fomo'] },
  { text: 'all green', tags: ['fomo'] },
  { text: '1m mcap soon', tags: ['fomo'] },
  { text: '10m next', tags: ['fomo'] },
  { text: '100m next', tags: ['fomo'] },
  { text: 'new ath', tags: ['fomo'] },
  { text: 'ath incoming', tags: ['fomo'] },
  { text: 'parabolic', tags: ['fomo'] },
  { text: 'straight up', tags: ['fomo'] },
  { text: 'moonshot', tags: ['fomo'] },
  { text: 'moonshot ser', tags: ['fomo'] },
  { text: 'thank you dev', tags: ['fomo'] },
  { text: 'inverse cramer', tags: ['fomo'] },
  { text: 'jeet', tags: ['roast'] },
  { text: 'jeet behavior', tags: ['roast'] },
  { text: 'typical jeet', tags: ['roast'] },
  { text: 'max jeet', tags: ['roast'] },
  { text: 'absolute jeet', tags: ['roast'] },
  { text: 'jeeted', tags: ['roast'] },
  { text: 'you jeeted', tags: ['roast'] },
  { text: 'youll jeet anyway', tags: ['roast'] },
  { text: 'peak jeet', tags: ['roast'] },
  { text: 'paper handed bozo', tags: ['roast'] },
  { text: 'diamond hands gone', tags: ['roast'] },
  { text: 'ngmi check', tags: ['roast'] },
  { text: 'ratio', tags: ['roast'] },
  { text: 'L', tags: ['roast'] },
  { text: 'L take', tags: ['roast'] },
  { text: 'L + ratio', tags: ['roast'] },
  { text: 'L + ratio + ngmi', tags: ['roast'] },
  { text: 'ratiod', tags: ['roast'] },
  { text: '+ bozo', tags: ['roast'] },
  { text: '+ skill issue', tags: ['roast'] },
  { text: 'rip bozo', tags: ['roast'] },
  { text: 'L bozo', tags: ['roast'] },
  { text: 'skill issue', tags: ['roast'] },
  { text: 'cope', tags: ['roast'] },
  { text: 'cope harder', tags: ['roast'] },
  { text: 'cope + seethe + mald', tags: ['roast'] },
  { text: 'seethe', tags: ['roast'] },
  { text: 'mald', tags: ['roast'] },
  { text: 'malding', tags: ['roast'] },
  { text: 'malding rn', tags: ['roast'] },
  { text: 'bro malding', tags: ['roast'] },
  { text: 'touch grass', tags: ['roast'] },
  { text: 'touch grass anon', tags: ['roast'] },
  { text: 'go outside', tags: ['roast'] },
  { text: 'go outside ser', tags: ['roast'] },
  { text: 'be quiet', tags: ['roast'] },
  { text: 'shut up', tags: ['roast'] },
  { text: 'stfu', tags: ['roast'] },
  { text: 'stfu bozo', tags: ['roast'] },
  { text: 'nobody asked', tags: ['roast'] },
  { text: 'who asked', tags: ['roast'] },
  { text: 'didnt ask', tags: ['roast'] },
  { text: 'lol no', tags: ['roast'] },
  { text: 'lmao no', tags: ['roast'] },
  { text: 'log off', tags: ['roast'] },
  { text: 'log off bro', tags: ['roast'] },
  { text: 'go to bed', tags: ['roast'] },
  { text: 'mid take', tags: ['roast'] },
  { text: 'mid opinion', tags: ['roast'] },
  { text: 'mid asf', tags: ['roast'] },
  { text: 'youre cooked', tags: ['roast'] },
  { text: 'youre joever', tags: ['roast'] },
  { text: 'you bozo', tags: ['roast'] },
  { text: 'cease yapping', tags: ['roast'] },
  { text: 'clear your throat', tags: ['roast'] },
  { text: 'imagine being you', tags: ['roast'] },
  { text: 'imagine being this mid', tags: ['roast'] },
  { text: 'this aint it', tags: ['roast'] },
  { text: 'this aint it chief', tags: ['roast'] },
  { text: 'have sex', tags: ['roast'] },
  { text: 'kill it with fire', tags: ['roast'] },
  { text: 'git gud', tags: ['roast'] },
  { text: 'noob', tags: ['roast'] },
  { text: 'scrub', tags: ['roast'] },
  { text: 'casual', tags: ['roast'] },
  { text: 'absolute clown', tags: ['roast'] },
  { text: 'clown moment', tags: ['roast'] },
  { text: 'clownery', tags: ['roast'] },
  { text: 'smol brain', tags: ['roast'] },
  { text: 'smooth brain', tags: ['roast'] },
  { text: 'single digit iq', tags: ['roast'] },
  { text: 'imagine selling', tags: ['roast'] },
  { text: 'you fumbled the bag', tags: ['roast'] },
  { text: 'bro fumbled', tags: ['roast'] },
  { text: 'bro is mid', tags: ['roast'] },
  { text: 'bro is cooked', tags: ['roast'] },
  { text: 'bro really thought', tags: ['roast'] },
  { text: 'bro thought he ate', tags: ['roast'] },
  { text: 'no thoughts', tags: ['roast'] },
  { text: 'head empty', tags: ['roast'] },
  { text: 'this is fine', tags: ['roast'] },
  { text: 'say less', tags: ['roast'] },
  { text: 'fr fr', tags: ['roast'] },
  { text: 'no cap', tags: ['roast'] },
  { text: 'it is what it is', tags: ['roast'] },
  { text: 'cooked', tags: ['roast'] },
  { text: 'so real', tags: ['roast'] },
  { text: 'literally me', tags: ['roast'] },
  { text: 'bestie', tags: ['roast'] },
  { text: 'the way I-', tags: ['roast'] },
  { text: 'its giving', tags: ['roast'] },
  { text: 'periodt', tags: ['roast'] },
  { text: 'main character energy', tags: ['roast'] },
  { text: 'rent free', tags: ['roast'] },
  { text: 'unhinged', tags: ['roast'] },
  { text: 'iykyk', tags: ['roast'] },
  { text: 'lmao', tags: ['roast'] },
  { text: 'lmaoooo', tags: ['roast'] },
  { text: 'sheesh', tags: ['roast'] },
  { text: 'bussin', tags: ['roast'] },
  { text: 'ohio', tags: ['roast'] },
  { text: 'only in ohio', tags: ['roast'] },
  { text: 'skibidi', tags: ['roast'] },
  { text: 'gyatt', tags: ['roast'] },
  { text: 'fanum tax', tags: ['roast'] },
  { text: 'rizz', tags: ['roast'] },
  { text: 'rizzler', tags: ['roast'] },
  { text: 'what the sigma', tags: ['roast'] },
  { text: 'erm what the sigma', tags: ['roast'] },
  { text: 'delulu', tags: ['roast'] },
  { text: 'imagine', tags: ['roast'] },
  { text: 'bro thinks hes him', tags: ['roast'] },
  { text: 'she thinks shes her', tags: ['roast'] },
  { text: 'and i oop', tags: ['roast'] },
  { text: 'sksksk', tags: ['roast'] },
  { text: 'the audacity', tags: ['roast'] },
  { text: 'stop', tags: ['roast'] },
  { text: 'i cant', tags: ['roast'] },
  { text: 'bruh', tags: ['roast'] },
  { text: 'bruh moment', tags: ['roast'] },
  { text: 'caught in 4k', tags: ['roast'] },
  { text: 'absolute cinema', tags: ['roast'] },
  { text: 'were so back', tags: ['roast'] },
  { text: 'so back', tags: ['roast'] },
  { text: 'im screaming', tags: ['roast'] },
  { text: 'im crying', tags: ['roast'] },
  { text: 'shaking rn', tags: ['roast'] },
  { text: 'sir this is a wendys', tags: ['roast'] },
  { text: 'sus', tags: ['roast'] },
  { text: 'say sike rn', tags: ['roast'] },
  { text: 'mogged', tags: ['roast'] },
  { text: 'mogger', tags: ['roast'] },
  { text: 'ill mog you', tags: ['roast'] },
  { text: 'peak fiction', tags: ['roast'] },
  { text: 'ngl', tags: ['roast'] },
  { text: 'based', tags: ['roast'] },
  { text: 'based and redpilled', tags: ['roast'] },
  { text: 'cringe', tags: ['roast'] },
  { text: 'mid', tags: ['roast'] },
  { text: 'absolute mid', tags: ['roast'] },
  { text: 'gigachad', tags: ['roast'] },
  { text: 'sigma', tags: ['roast'] },
  { text: 'sigma grindset', tags: ['roast'] },
];

// ============ 10 次不重复 history ============

const RECENT_LIMIT = 10;
const _recentZh: string[] = [];
const _recentEn: string[] = [];

function rememberPick(lang: 'zh' | 'en', text: string) {
  const arr = lang === 'zh' ? _recentZh : _recentEn;
  arr.push(text);
  while (arr.length > RECENT_LIMIT) arr.shift();
}

// ============ 选择器 ============

function poolForMode(all: ModedText[], mode: Mode | 'all'): ModedText[] {
  const filtered = mode === 'all' ? all : all.filter((t) => t.tags.includes(mode));
  // 按 text dedup (源池 + DEV 用户加的可能重复)
  const seen = new Set<string>();
  const out: ModedText[] = [];
  for (const t of filtered) {
    if (seen.has(t.text)) continue;
    seen.add(t.text);
    out.push(t);
  }
  return out;
}

function getDevExtras(lang: 'zh' | 'en'): ModedText[] {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return [];
  try {
    const raw = localStorage.getItem('pmw-caption-overrides-v1');
    if (!raw) return [];
    const arr = JSON.parse(raw) as Array<{ text: string; lang: 'zh' | 'en'; tags: Mode[] }>;
    return arr
      .filter((u) => u.lang === lang && typeof u.text === 'string' && u.text.trim())
      .map((u) => ({ text: u.text, tags: Array.isArray(u.tags) ? u.tags.filter((t) => (ALL_MODES as string[]).includes(t)) : [] }));
  } catch {
    return [];
  }
}

// DEV-only: 源 caption 用户标记删除的集合 (校准 → 文案管理可删源条目, runtime 屏蔽)
function getDeletedSet(): Set<string> {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return new Set();
  try {
    const raw = localStorage.getItem('pmw-caption-deleted-v1');
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((t) => typeof t === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function pickRandomText(lang: 'zh' | 'en', mode: Mode | 'all' = 'all', exclude?: string): string {
  const base = lang === 'zh' ? TEXTS_ZH : TEXTS_EN;
  const deleted = getDeletedSet();
  const baseFiltered = base.filter((t) => !deleted.has(t.text));
  const all = [...baseFiltered, ...getDevExtras(lang)];
  let pool = poolForMode(all, mode);

  // EN 池为空 fallback 走 ZH (也屏蔽 deleted)
  if (pool.length === 0 && lang === 'en' && TEXTS_EN.length === 0) {
    pool = poolForMode(TEXTS_ZH.filter((t) => !deleted.has(t.text)), mode);
  }
  if (pool.length === 0) return '';

  const recent = lang === 'zh' ? _recentZh : _recentEn;
  const excludeSet = new Set<string>(recent);
  if (exclude) excludeSet.add(exclude);
  let candidates = pool.filter((t) => !excludeSet.has(t.text));
  // 池子太小被排干: 放开 recent 兜底 (但仍排掉当前 exclude)
  if (candidates.length === 0) {
    candidates = pool.filter((t) => t.text !== exclude);
    if (candidates.length === 0) candidates = pool;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)].text;
  rememberPick(lang, picked);
  return picked;
}

// ============ 向后兼容 ============

export const RECOMMEND_TEXTS_ZH: string[] = TEXTS_ZH.map((t) => t.text);
export const RECOMMEND_TEXTS_EN: string[] = TEXTS_EN.map((t) => t.text);
export const RANDOM_TEXTS_ZH = RECOMMEND_TEXTS_ZH;
export const RANDOM_TEXTS_EN = RECOMMEND_TEXTS_EN;

// mode 标签 — v5: 去掉 abstract, 斗图涵盖
export const MODE_LABELS: Record<Mode | 'all', { zh: string; en: string }> = {
  all:   { zh: '默认',  en: 'Default' },
  fomo:  { zh: 'FOMO',  en: 'FOMO' },
  fud:   { zh: 'FUD',   en: 'FUD' },
  roast: { zh: '斗图',  en: 'Roast' },
};

export const MODE_CYCLE: Array<Mode | 'all'> = ['all', 'fomo', 'fud', 'roast'];

export function nextMode(cur: Mode | 'all'): Mode | 'all' {
  const i = MODE_CYCLE.indexOf(cur);
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}
