export interface Material {
  id: string;
  src: string;
  labelCn: string;
  labelEn: string;
  tags: string[];
  tagsEn: string[];
  faceOffset: { x: number; y: number; w: number; h: number };
  // 字幕偏移 (px, 350-coord 空间): 正数 = panda 图片往下挪贴近 caption (缩小间距)
  // 由校准工具调好后 export 到 panda-manual-overrides.ts 永久生效
  captionOffset?: number;
}

const defaultOffset = { x: 100, y: 70, w: 250, h: 250 };
const altOffset1 = { x: 90, y: 60, w: 270, h: 270 };
const altOffset2 = { x: 110, y: 80, w: 230, h: 230 };
const smallOffset = { x: 120, y: 90, w: 210, h: 210 };
const largeOffset = { x: 80, y: 50, w: 290, h: 290 };

// ===== 熊猫头素材 (24张) =====
export const PANDA_HEADS: Material[] = [
  { id: 'panda-01', src: './assets/panda-01.png', labelCn: '熊猫基础', labelEn: 'Basic', tags: ['基础','熊猫'], tagsEn: ['basic','panda'], faceOffset: defaultOffset },
  { id: 'panda-02', src: './assets/panda-02.png', labelCn: '站立熊猫', labelEn: 'Standing', tags: ['站立','熊猫'], tagsEn: ['standing','panda'], faceOffset: defaultOffset },
  { id: 'panda-03', src: './assets/panda-03.png', labelCn: '倚靠熊猫', labelEn: 'Leaning', tags: ['倚靠','熊猫'], tagsEn: ['leaning','panda'], faceOffset: altOffset1 },
  { id: 'panda-04', src: './assets/panda-04.png', labelCn: '躺平熊猫', labelEn: 'Lying', tags: ['躺平','熊猫'], tagsEn: ['lying','panda'], faceOffset: defaultOffset },
  { id: 'panda-05', src: './assets/panda-05.png', labelCn: '挥手熊猫', labelEn: 'Waving', tags: ['挥手','熊猫'], tagsEn: ['waving','panda'], faceOffset: defaultOffset },
  { id: 'panda-06', src: './assets/panda-06.png', labelCn: '叉腰熊猫', labelEn: 'Armcross', tags: ['叉腰','熊猫'], tagsEn: ['armcross','panda'], faceOffset: defaultOffset },
  { id: 'panda-07', src: './assets/panda-07.png', labelCn: '飞翔熊猫', labelEn: 'Flying', tags: ['飞翔','熊猫'], tagsEn: ['flying','panda'], faceOffset: altOffset2 },
  { id: 'panda-08', src: './assets/panda-08.png', labelCn: '疑问熊猫', labelEn: 'Question', tags: ['疑问','熊猫'], tagsEn: ['question','panda'], faceOffset: altOffset1 },
  { id: 'panda-09', src: './assets/panda-09.png', labelCn: '扶栏熊猫', labelEn: 'Railing', tags: ['扶栏','熊猫'], tagsEn: ['railing','panda'], faceOffset: defaultOffset },
  { id: 'panda-10', src: './assets/panda-10.png', labelCn: '敬礼熊猫', labelEn: 'Salute', tags: ['敬礼','熊猫'], tagsEn: ['salute','panda'], faceOffset: smallOffset },
  { id: 'panda-11', src: './assets/panda-11.png', labelCn: '侧面熊猫', labelEn: 'Side', tags: ['侧面','熊猫'], tagsEn: ['side','panda'], faceOffset: defaultOffset },
  { id: 'panda-12', src: './assets/panda-12.png', labelCn: '站立2', labelEn: 'Stand2', tags: ['站立','熊猫'], tagsEn: ['standing','panda'], faceOffset: altOffset1 },
  { id: 'panda-13', src: './assets/panda-13.png', labelCn: '椭圆呆萌', labelEn: 'Oval Dazed', tags: ['呆萌','椭圆'], tagsEn: ['dazed','oval'], faceOffset: defaultOffset },
  { id: 'panda-14', src: './assets/panda-14.png', labelCn: '三角挑衅', labelEn: 'Triangular', tags: ['挑衅','三角'], tagsEn: ['provocative','triangular'], faceOffset: largeOffset },
  { id: 'panda-15', src: './assets/panda-15.png', labelCn: '方块正直', labelEn: 'Square', tags: ['正直','方块'], tagsEn: ['square','honest'], faceOffset: largeOffset },
  { id: 'panda-16', src: './assets/panda-16.png', labelCn: '爱心环绕', labelEn: 'Heart Ring', tags: ['爱心','可爱'], tagsEn: ['love','cute'], faceOffset: smallOffset },
  { id: 'panda-17', src: './assets/panda-17.png', labelCn: '黄帽平淡', labelEn: 'Yellow Cap', tags: ['平淡','帽子'], tagsEn: ['plain','cap'], faceOffset: altOffset1 },
  { id: 'panda-18', src: './assets/panda-18.png', labelCn: '红顶冒汗', labelEn: 'Red Top Sweat', tags: ['冒汗','紧张'], tagsEn: ['sweat','nervous'], faceOffset: defaultOffset },
  { id: 'panda-19', src: './assets/panda-19.png', labelCn: '被子睡觉', labelEn: 'Bed Sleep', tags: ['睡觉','躺平'], tagsEn: ['sleep','bed'], faceOffset: altOffset2 },
  { id: 'panda-20', src: './assets/panda-20.png', labelCn: '窗帘偷看', labelEn: 'Curtain Peep', tags: ['偷窥','好奇'], tagsEn: ['peep','curious'], faceOffset: smallOffset },
  { id: 'panda-21', src: './assets/panda-21.png', labelCn: '挠头思考', labelEn: 'Scratch Head', tags: ['思考','挠头'], tagsEn: ['thinking','scratch'], faceOffset: altOffset1 },
  { id: 'panda-22', src: './assets/panda-22.png', labelCn: '趴地投降', labelEn: 'Surrender', tags: ['投降','无语'], tagsEn: ['surrender','defeated'], faceOffset: largeOffset },
  { id: 'panda-23', src: './assets/panda-23.png', labelCn: '大脸基础', labelEn: 'Big Face', tags: ['基础','大脸'], tagsEn: ['basic','big'], faceOffset: largeOffset },
  { id: 'panda-24', src: './assets/panda-24.png', labelCn: '粉蝴蝶结', labelEn: 'Pink Bow', tags: ['可爱','蝴蝶结'], tagsEn: ['cute','bow'], faceOffset: smallOffset },
];

// ===== 人脸素材 (67张) =====
export const FACES: Material[] = [
  { id: 'face-01', src: './assets/face-01.png', labelCn: '金馆长微笑', labelEn: 'Kim Grin', tags: ['微笑','金馆长'], tagsEn: ['grin','kim'], faceOffset: defaultOffset },
  { id: 'face-02', src: './assets/face-02.png', labelCn: '张学友无奈', labelEn: 'Cheung Wry', tags: ['无奈','张学友'], tagsEn: ['wry','cheung'], faceOffset: defaultOffset },
  { id: 'face-03', src: './assets/face-03.png', labelCn: '姚明大笑', labelEn: 'Yao Laugh', tags: ['大笑','姚明'], tagsEn: ['laugh','yao'], faceOffset: defaultOffset },
  { id: 'face-04', src: './assets/face-04.png', labelCn: '花泽香菜', labelEn: 'Kana Smile', tags: ['微笑','香菜'], tagsEn: ['smile','kana'], faceOffset: defaultOffset },
  { id: 'face-05', src: './assets/face-05.png', labelCn: 'doge', labelEn: 'Doge', tags: ['doge','狗'], tagsEn: ['doge','dog'], faceOffset: defaultOffset },
  { id: 'face-06', src: './assets/face-06.png', labelCn: 'Trollface', labelEn: 'Trollface', tags: ['恶搞','troll'], tagsEn: ['troll','meme'], faceOffset: defaultOffset },
  { id: 'face-07', src: './assets/face-07.png', labelCn: '愤怒脸', labelEn: 'Rage Face', tags: ['愤怒','rage'], tagsEn: ['rage','angry'], faceOffset: defaultOffset },
  { id: 'face-08', src: './assets/face-08.png', labelCn: '悲伤青蛙', labelEn: 'Sad Frog', tags: ['悲伤','青蛙'], tagsEn: ['sad','frog'], faceOffset: defaultOffset },
  { id: 'face-09', src: './assets/face-09.png', labelCn: '滑稽点头', labelEn: 'Nodding', tags: ['滑稽','点头'], tagsEn: ['smug','nod'], faceOffset: defaultOffset },
  { id: 'face-10', src: './assets/face-10.png', labelCn: '滑稽摇头', labelEn: 'Head Shake', tags: ['滑稽','摇头'], tagsEn: ['smug','shake'], faceOffset: defaultOffset },
  { id: 'face-11', src: './assets/face-11.png', labelCn: '吃瓜表情', labelEn: 'Melon Face', tags: ['吃瓜','看戏'], tagsEn: ['melon','watch'], faceOffset: defaultOffset },
  { id: 'face-12', src: './assets/face-12.png', labelCn: '扭曲脸', labelEn: 'Distorted', tags: ['痛苦','扭曲'], tagsEn: ['pain','distorted'], faceOffset: defaultOffset },
  { id: 'face-13', src: './assets/face-13.png', labelCn: '阴险笑容', labelEn: 'Sinister Grin', tags: ['阴险','坏笑'], tagsEn: ['sinister','evil'], faceOffset: defaultOffset },
  { id: 'face-14', src: './assets/face-14.png', labelCn: '无语翻白', labelEn: 'Blank Stare', tags: ['无语','翻白'], tagsEn: ['speechless','blank'], faceOffset: defaultOffset },
  { id: 'face-15', src: './assets/face-15.png', labelCn: '痛苦面具', labelEn: 'Pain Mask', tags: ['痛苦','面具'], tagsEn: ['pain','mask'], faceOffset: defaultOffset },
  { id: 'face-new-10', src: './assets/faces/1 (10).png', labelCn: '馆长微笑', labelEn: 'Grin 1', tags: ['微笑','金馆长'], tagsEn: ['grin','kim'], faceOffset: defaultOffset },
  { id: 'face-new-11', src: './assets/faces/1 (11).png', labelCn: '馆长坏笑', labelEn: 'Evil 1', tags: ['坏笑','金馆长'], tagsEn: ['evil','kim'], faceOffset: defaultOffset },
  { id: 'face-new-12', src: './assets/faces/1 (12).png', labelCn: '馆长挑眉', labelEn: 'Brow 1', tags: ['挑眉','金馆长'], tagsEn: ['brow','kim'], faceOffset: defaultOffset },
  { id: 'face-new-13', src: './assets/faces/1 (13).png', labelCn: '馆长大笑', labelEn: 'Laugh 1', tags: ['大笑','金馆长'], tagsEn: ['laugh','kim'], faceOffset: defaultOffset },
  { id: 'face-new-14', src: './assets/faces/1 (14).png', labelCn: '馆长嘲讽', labelEn: 'Mock 1', tags: ['嘲讽','金馆长'], tagsEn: ['mock','kim'], faceOffset: defaultOffset },
  { id: 'face-new-15', src: './assets/faces/1 (15).png', labelCn: '馆长无奈', labelEn: 'Helpless 1', tags: ['无奈','金馆长'], tagsEn: ['helpless','kim'], faceOffset: defaultOffset },
  { id: 'face-new-16', src: './assets/faces/1 (16).png', labelCn: '馆长害羞', labelEn: 'Shy 1', tags: ['害羞','金馆长'], tagsEn: ['shy','kim'], faceOffset: defaultOffset },
  { id: 'face-new-17', src: './assets/faces/1 (17).png', labelCn: '馆长自信', labelEn: 'Confident 1', tags: ['自信','金馆长'], tagsEn: ['confident','kim'], faceOffset: defaultOffset },
  { id: 'face-new-18', src: './assets/faces/1 (18).png', labelCn: '馆长尴尬', labelEn: 'Awkward 1', tags: ['尴尬','金馆长'], tagsEn: ['awkward','kim'], faceOffset: defaultOffset },
  { id: 'face-new-19', src: './assets/faces/1 (19).png', labelCn: '馆长愤怒', labelEn: 'Angry 1', tags: ['愤怒','金馆长'], tagsEn: ['angry','kim'], faceOffset: defaultOffset },
  { id: 'face-new-20', src: './assets/faces/1 (20).png', labelCn: '馆长痛苦', labelEn: 'Pain 1', tags: ['痛苦','金馆长'], tagsEn: ['pain','kim'], faceOffset: defaultOffset },
  { id: 'face-new-21', src: './assets/faces/1 (21).png', labelCn: '馆长委屈', labelEn: 'Pitiful 1', tags: ['委屈','金馆长'], tagsEn: ['pitiful','kim'], faceOffset: defaultOffset },
  { id: 'face-new-22', src: './assets/faces/1 (22).png', labelCn: '馆长惊讶', labelEn: 'Surprised 1', tags: ['惊讶','金馆长'], tagsEn: ['surprised','kim'], faceOffset: defaultOffset },
  { id: 'face-new-23', src: './assets/faces/1 (23).png', labelCn: '馆长得意', labelEn: 'Smug 1', tags: ['得意','金馆长'], tagsEn: ['smug','kim'], faceOffset: defaultOffset },
  { id: 'face-new-24', src: './assets/faces/1 (24).png', labelCn: '馆长无聊', labelEn: 'Bored 1', tags: ['无聊','金馆长'], tagsEn: ['bored','kim'], faceOffset: defaultOffset },
  { id: 'face-new-25', src: './assets/faces/1 (25).png', labelCn: '馆长酷酷', labelEn: 'Cool 1', tags: ['酷','金馆长'], tagsEn: ['cool','kim'], faceOffset: defaultOffset },
  { id: 'face-new-26', src: './assets/faces/1 (26).png', labelCn: '馆长感动', labelEn: 'Touched 1', tags: ['感动','金馆长'], tagsEn: ['touched','kim'], faceOffset: defaultOffset },
  { id: 'face-new-27', src: './assets/faces/1 (27).png', labelCn: '馆长恐惧', labelEn: 'Scared 1', tags: ['恐惧','金馆长'], tagsEn: ['scared','kim'], faceOffset: defaultOffset },
  { id: 'face-new-28', src: './assets/faces/1 (28).png', labelCn: '馆长迷茫', labelEn: 'Lost 1', tags: ['迷茫','金馆长'], tagsEn: ['lost','kim'], faceOffset: defaultOffset },
  { id: 'face-new-29', src: './assets/faces/1 (29).png', labelCn: '馆长睡觉', labelEn: 'Sleepy 1', tags: ['睡觉','金馆长'], tagsEn: ['sleepy','kim'], faceOffset: defaultOffset },
  { id: 'face-new-30', src: './assets/faces/1 (30).png', labelCn: '馆长震惊', labelEn: 'Shocked 1', tags: ['震惊','金馆长'], tagsEn: ['shocked','kim'], faceOffset: defaultOffset },
  { id: 'face-new-31', src: './assets/faces/1 (31).png', labelCn: '馆长流泪', labelEn: 'Tear 1', tags: ['流泪','金馆长'], tagsEn: ['tear','kim'], faceOffset: defaultOffset },
  { id: 'face-new-32', src: './assets/faces/1 (32).png', labelCn: '馆长偷笑', labelEn: 'Giggle 1', tags: ['偷笑','金馆长'], tagsEn: ['giggle','kim'], faceOffset: defaultOffset },
  { id: 'face-new-33', src: './assets/faces/1 (33).png', labelCn: '馆长嫌弃', labelEn: 'Disgust 1', tags: ['嫌弃','金馆长'], tagsEn: ['disgust','kim'], faceOffset: defaultOffset },
  { id: 'face-new-34', src: './assets/faces/1 (34).png', labelCn: '馆长思索', labelEn: 'Thinking 1', tags: ['思考','金馆长'], tagsEn: ['thinking','kim'], faceOffset: defaultOffset },
  { id: 'face-new-35', src: './assets/faces/1 (35).png', labelCn: '馆长无语', labelEn: 'Speechless 1', tags: ['无语','金馆长'], tagsEn: ['speechless','kim'], faceOffset: defaultOffset },
  { id: 'face-new-36', src: './assets/faces/1 (36).png', labelCn: '馆长加油', labelEn: 'Cheer 1', tags: ['加油','金馆长'], tagsEn: ['cheer','kim'], faceOffset: defaultOffset },
  { id: 'face-new-37', src: './assets/faces/1 (37).png', labelCn: '馆长惊恐', labelEn: 'Terrified 1', tags: ['惊恐','金馆长'], tagsEn: ['terrified','kim'], faceOffset: defaultOffset },
  { id: 'face-new-38', src: './assets/faces/1 (38).png', labelCn: '馆长犯困', labelEn: 'Drowsy 1', tags: ['犯困','金馆长'], tagsEn: ['drowsy','kim'], faceOffset: defaultOffset },
  { id: 'face-new-39', src: './assets/faces/1 (39).png', labelCn: '馆长可爱', labelEn: 'Cute 1', tags: ['可爱','金馆长'], tagsEn: ['cute','kim'], faceOffset: defaultOffset },
  { id: 'face-new-40', src: './assets/faces/1 (40).png', labelCn: '馆长不屑', labelEn: 'Disdain 1', tags: ['不屑','金馆长'], tagsEn: ['disdain','kim'], faceOffset: defaultOffset },
  { id: 'face-new-41', src: './assets/faces/1 (41).png', labelCn: '馆长开心', labelEn: 'Happy 1', tags: ['开心','金馆长'], tagsEn: ['happy','kim'], faceOffset: defaultOffset },
  { id: 'face-new-42', src: './assets/faces/1 (42).png', labelCn: '馆长难过', labelEn: 'Sad 1', tags: ['难过','金馆长'], tagsEn: ['sad','kim'], faceOffset: defaultOffset },
  { id: 'face-new-43', src: './assets/faces/1 (43).png', labelCn: '馆长点赞', labelEn: 'Thumbs 1', tags: ['点赞','金馆长'], tagsEn: ['thumbs','kim'], faceOffset: defaultOffset },
  { id: 'face-new-44', src: './assets/faces/1 (44).png', labelCn: '馆长卖萌', labelEn: 'Moe 1', tags: ['卖萌','金馆长'], tagsEn: ['moe','kim'], faceOffset: defaultOffset },
  { id: 'face-new-45', src: './assets/faces/1 (45).png', labelCn: '馆长心痛', labelEn: 'Heartache 1', tags: ['心痛','金馆长'], tagsEn: ['heartache','kim'], faceOffset: defaultOffset },
  { id: 'face-new-46', src: './assets/faces/1 (46).png', labelCn: '馆长期待', labelEn: 'Excited 1', tags: ['期待','金馆长'], tagsEn: ['excited','kim'], faceOffset: defaultOffset },
  { id: 'face-new-47', src: './assets/faces/1 (47).png', labelCn: '馆长悲伤', labelEn: 'Sorrow 1', tags: ['悲伤','金馆长'], tagsEn: ['sorrow','kim'], faceOffset: defaultOffset },
  { id: 'face-new-48', src: './assets/faces/1 (48).png', labelCn: '馆长打call', labelEn: 'Call 1', tags: ['打call','金馆长'], tagsEn: ['call','kim'], faceOffset: defaultOffset },
  { id: 'face-new-49', src: './assets/faces/1 (49).png', labelCn: '馆长无语', labelEn: 'Blank 1', tags: ['无语','金馆长'], tagsEn: ['blank','kim'], faceOffset: defaultOffset },
  { id: 'face-new-50', src: './assets/faces/1 (50).png', labelCn: '馆长搞笑', labelEn: 'Funny 1', tags: ['搞笑','金馆长'], tagsEn: ['funny','kim'], faceOffset: defaultOffset },
  { id: 'face-new-51', src: './assets/faces/1 (51).png', labelCn: '馆长吃惊', labelEn: 'Amazed 1', tags: ['吃惊','金馆长'], tagsEn: ['amazed','kim'], faceOffset: defaultOffset },
  { id: 'face-new-52', src: './assets/faces/1 (52).png', labelCn: '馆长抓狂', labelEn: 'Frantic 1', tags: ['抓狂','金馆长'], tagsEn: ['frantic','kim'], faceOffset: defaultOffset },
  { id: 'face-new-53', src: './assets/faces/1 (53).png', labelCn: '馆长俏皮', labelEn: 'Playful 1', tags: ['俏皮','金馆长'], tagsEn: ['playful','kim'], faceOffset: defaultOffset },
  { id: 'face-new-54', src: './assets/faces/1 (54).png', labelCn: '馆长温柔', labelEn: 'Gentle 1', tags: ['温柔','金馆长'], tagsEn: ['gentle','kim'], faceOffset: defaultOffset },
  { id: 'face-new-55', src: './assets/faces/1 (55).png', labelCn: '馆长怀疑', labelEn: 'Doubtful 1', tags: ['怀疑','金馆长'], tagsEn: ['doubtful','kim'], faceOffset: defaultOffset },
  { id: 'face-new-56', src: './assets/faces/1 (56).png', labelCn: '馆长哭笑', labelEn: 'LaughCry 1', tags: ['哭笑','金馆长'], tagsEn: ['laughcry','kim'], faceOffset: defaultOffset },
  { id: 'face-new-57', src: './assets/faces/1 (57).png', labelCn: '馆长严肃', labelEn: 'Serious 1', tags: ['严肃','金馆长'], tagsEn: ['serious','kim'], faceOffset: defaultOffset },
  { id: 'face-new-58', src: './assets/faces/1 (58).png', labelCn: '馆长夸张', labelEn: 'Dramatic 1', tags: ['夸张','金馆长'], tagsEn: ['dramatic','kim'], faceOffset: defaultOffset },
  { id: 'face-new-59', src: './assets/faces/1 (59).png', labelCn: '馆长哭脸', labelEn: 'Crying 1', tags: ['哭泣','金馆长'], tagsEn: ['crying','kim'], faceOffset: defaultOffset },
  { id: 'face-new-60', src: './assets/faces/1 (60).png', labelCn: '馆长狂喜', labelEn: 'Ecstatic 1', tags: ['狂喜','金馆长'], tagsEn: ['ecstatic','kim'], faceOffset: defaultOffset },
  { id: 'face-new-61', src: './assets/faces/1 (61).png', labelCn: '馆长淡定', labelEn: 'Calm 1', tags: ['淡定','金馆长'], tagsEn: ['calm','kim'], faceOffset: defaultOffset },
];

// ===== 人脸偏移映射 =====
const pandaOffsetMap: Record<string, { x: number; y: number; w: number; h: number }> = {};
PANDA_HEADS.forEach(p => { pandaOffsetMap[p.id] = p.faceOffset; });

export function getPandaFaceOffset(pandaId: string): { x: number; y: number; w: number; h: number } {
  return pandaOffsetMap[pandaId] || defaultOffset;
}

// ===== PandaHead 贡献的 46 panda + 65 face (来源 https://pandahead.fun) =====
import { PANDAHEAD_PANDAS } from './panda-pandahead';
import { PANDAHEAD_FACES } from './face-pandahead';

/** 完整 panda 池：原 24 + PandaHead 贡献 46 = 70 */
export const ALL_PANDAS: Material[] = [...PANDA_HEADS, ...PANDAHEAD_PANDAS];
/** 完整 face 池：原 67 + PandaHead 贡献 65 = 132 */
export const ALL_FACES: Material[] = [...FACES, ...PANDAHEAD_FACES];

PANDAHEAD_PANDAS.forEach(p => { pandaOffsetMap[p.id] = p.faceOffset; });

// ===== align_panda.py 自动检测的 24 个 native panda anchor overrides =====
import { PANDA_ALIGN_OVERRIDES } from './panda-align-overrides';
PANDA_HEADS.forEach(p => {
  const override = PANDA_ALIGN_OVERRIDES[p.id];
  if (override) {
    p.faceOffset = override;
    pandaOffsetMap[p.id] = override;
  }
});

// ===== 手动校准 — 70 个 panda 全部肉眼校准的 anchor (最高优先级) =====
// 必须迭代 [PANDA_HEADS, PANDAHEAD_PANDAS] 70 个全应用，不能只迭代 PANDA_HEADS
import { PANDA_MANUAL_OVERRIDES, PANDA_CAPTION_OFFSETS } from './panda-manual-overrides';
[...PANDA_HEADS, ...PANDAHEAD_PANDAS].forEach((p) => {
  const manual = PANDA_MANUAL_OVERRIDES[p.id];
  if (manual) {
    p.faceOffset = manual;
    pandaOffsetMap[p.id] = manual;
  }
  // 同名 record: caption 偏移 (校准工具 export 时输出, 老版本可能没有 → 兼容缺失)
  const capOff = PANDA_CAPTION_OFFSETS?.[p.id];
  if (typeof capOff === 'number') {
    p.captionOffset = capOff;
  }
});

// ===== DEV-only: 实时从 localStorage 读校准工具 override =====
// 校准工具改了 localStorage 后 dispatch 'pmw-anchor-changed' event；消费方用 useLiveAnchor hook 自动 re-render
// 注意：localStorage 按 origin 隔离，跨端口不同步（浏览器机制）
export function getLivePandaFaceOffset(panda: Material): { x: number; y: number; w: number; h: number } {
  if (import.meta.env.DEV) {
    try {
      const stored = JSON.parse(localStorage.getItem('pmw-anchor-overrides-v1') || '{}');
      const ov = stored[panda.id];
      if (ov?.faceOffset) return ov.faceOffset;
    } catch {
      /* ignore */
    }
  }
  return panda.faceOffset;
}

// ===== shell 类型: 透明抠图 vs 不透明白底 =====
// 句跃金抠的 45 张 panda-ph-001..045 都是透明 (face 区透明 + 背景透明, 仅黑廓)
// 例外: panda-ph-046 没收到抠图, 还是原版不透明
// LittleRed 原版 panda-01 .. 24 是不透明白底 (face 区是 opaque white)
// 影响图层叠加: 透明 shell 把 panda 放上面 multiply; 不透明 shell 把 face 放上面 multiply
const TRANSPARENT_SHELLS = new Set<string>();
for (let i = 1; i <= 45; i++) {
  TRANSPARENT_SHELLS.add(`panda-ph-${String(i).padStart(3, '0')}`);
}

export function isTransparentShell(pandaId: string): boolean {
  return TRANSPARENT_SHELLS.has(pandaId);
}

// 给定 panda id, 返回它跟 face 配对时的图层方案
// - 透明 panda: panda zIndex=5 (上, multiply), face zIndex=1 (下)
// - 不透明 panda: face zIndex=5 (上, multiply), panda zIndex=1 (下)
// text 永远 100 不变
export function getShellLayering(pandaId: string): {
  pandaZ: number;
  faceZ: number;
  pandaBlend: 'multiply' | 'normal';
  faceBlend: 'multiply' | 'normal';
} {
  if (isTransparentShell(pandaId)) {
    return { pandaZ: 5, faceZ: 1, pandaBlend: 'multiply', faceBlend: 'normal' };
  }
  return { pandaZ: 1, faceZ: 5, pandaBlend: 'normal', faceBlend: 'multiply' };
}

// ===== 素材元数据 (rename / hide) =====
// DEV 校准工具的"素材管理"可视化改 — 写 localStorage 'pmw-material-meta-v1'
// 这里只是 helper, 供 leftsidebar / quickmode 等 picker 调用过滤 + 拿覆盖后的 label
export function getLiveMaterialLabel(m: Material, lang: 'zh' | 'en'): string {
  if (typeof window !== 'undefined') {
    try {
      const meta = JSON.parse(localStorage.getItem('pmw-material-meta-v1') || '{}');
      const e = meta[m.id];
      if (e) {
        if (lang === 'zh' && e.labelCn) return e.labelCn;
        if (lang === 'en' && e.labelEn) return e.labelEn;
      }
    } catch { /* ignore */ }
  }
  return lang === 'zh' ? m.labelCn : m.labelEn;
}

export function isMaterialHidden(m: Material): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const meta = JSON.parse(localStorage.getItem('pmw-material-meta-v1') || '{}');
    return Boolean(meta[m.id]?.hidden);
  } catch {
    return false;
  }
}

// 字幕偏移 (px, 350-coord 空间) — 校准工具改, 正数让 panda 图片往下挪
// 优先级: DEV localStorage (实时校准) > Material.captionOffset (永久 shipped 值) > 0
export function getLiveCaptionOffset(pandaOrId: Material | string): number {
  if (typeof window === 'undefined') {
    return typeof pandaOrId !== 'string' ? (pandaOrId.captionOffset ?? 0) : 0;
  }
  const id = typeof pandaOrId === 'string' ? pandaOrId : pandaOrId.id;
  // 1. DEV 实时 localStorage (仅本地校准)
  if (import.meta.env.DEV) {
    try {
      const stored = JSON.parse(localStorage.getItem('pmw-anchor-overrides-v1') || '{}');
      const ov = stored[id];
      if (typeof ov?.captionOffset === 'number') return ov.captionOffset;
    } catch {
      /* ignore */
    }
  }
  // 2. Material 永久值 (panda-manual-overrides.ts shipped 到 prod)
  if (typeof pandaOrId !== 'string' && typeof pandaOrId.captionOffset === 'number') {
    return pandaOrId.captionOffset;
  }
  // 3. 通过 id 查找 (兜底, 给 collection 等只有 id 的调用方)
  const all = [...PANDA_HEADS, ...PANDAHEAD_PANDAS];
  const found = all.find(p => p.id === id);
  if (found && typeof found.captionOffset === 'number') return found.captionOffset;
  return 0;
}
