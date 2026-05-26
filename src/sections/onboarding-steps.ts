// onboarding-steps.ts — 新手引导「数据 + 类型」层
// 跟组件分离的原因: react-refresh/only-export-components 规则会把「组件文件里导出数组/函数」判为
// 错误 (见 appdialog.tsx 同类报错). 把纯数据 (step 数组 / 类型 / 常量) 放这个非组件文件,
// onboarding.tsx 再 re-export → host 仍可从 onboarding.tsx 一处 import, 同时 eslint 干净.
//
// 内容全部对照真实 UI 写 (animatemode.tsx 视频视图 5 段 segbar / gifmode.tsx GIF 视图 3 段),
// anchor 选择器统一 [data-tour="KEY"], host 把这些 KEY 加到对应真实元素上即可 (见 onboarding.tsx 头部清单).

// ============================================================
// 类型
// ============================================================
export interface OnboardingStep {
  id: string;
  /** 要高亮的元素 CSS 选择器, 如 '[data-tour="mode-toggle"]'; 省略 = 居中弹窗 (不打洞) */
  anchor?: string;
  /** coach 卡相对 anchor 的方位; 越界会自动翻转. 'center' = 强制居中 */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  title: { zh: string; en: string };
  body: { zh: string; en: string };
  /** 可选的「动手 demo」提示类型 — 仅做视觉引导 (脉冲手势), 不劫持真实编辑器事件, 永远可点「下一步」跳过 */
  demo?: 'drag-layer' | 'click-motion' | 'add-combo' | null;
}

export interface OnboardingProps {
  open: boolean;
  lang: 'zh' | 'en';
  /** 配色主题: video = 深色 + 橙 #FF5E00; gif = Win7 Aero 浅蓝玻璃 + 金色高亮 */
  theme: 'video' | 'gif';
  /** 用哪套步骤: video / gif */
  view: 'video' | 'gif';
  /** 点 X / 跳过 → 关闭 (未走完) */
  onClose: () => void;
  /** 走完最后一步 → 完成 */
  onFinish: () => void;
  /** 自定义步骤; 不传则按 view 用内置 DEFAULT_VIDEO_STEPS / DEFAULT_GIF_STEPS */
  steps?: OnboardingStep[];
  /**
   * 可选: host 想做「真·事件驱动 demo 自动推进」时, 把一个注册器传进来.
   * 组件会在带 demo 的步骤挂载时调用 register(demoType, advance), host 在用户真的完成该动作
   * (如真把图层拖动了) 时调用 advance() 即可自动跳到下一步. 不传 = 纯视觉引导 + 手动「下一步」.
   */
  onDemoMount?: (demo: NonNullable<OnboardingStep['demo']>, advance: () => void) => void | (() => void);
}

// ============================================================
// localStorage key — host 用它判断「是否首次打开 → 自动弹引导」
// (字符串常量, 放组件文件也不会触发 react-refresh; 但统一放这里便于 host 一处 import)
// ============================================================
export const ONBOARDING_SEEN_KEY = 'xmw.animate-onboarding.seen.v1';

// ============================================================
// 视频视图步骤 (~8 步) — 对照 animatemode.tsx 真实区块
//   左栏 5 段: 素材(配套/熊猫/表情/场景/草图/上传/联网搜) · 音乐 · 配音 · 字幕 · 动效
//   中间预览画板 (DOM 图层 + 橙选框 + 拖动移动) · 底部时间轴 (clips + 时长手柄) · 右侧 Inspector
// ============================================================
export const DEFAULT_VIDEO_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    title: { zh: '欢迎来到沙雕动画 🎬', en: 'Welcome to Silly Animation 🎬' },
    body: {
      zh: '3 分钟做出你的第一个会动的熊猫头表情包。功能很多别慌 — 跟着这几步走一遍就懂了。\n\n💡 这里能「上传你自己的图片」做二创：截图、梗图、自拍都行，传进来直接当素材用。',
      en: 'Make your first animated panda meme in 3 minutes. Lots of features — don\'t panic, just follow these steps.\n\n💡 You can upload your own images to remix: screenshots, memes, selfies — all usable as material.',
    },
    demo: null,
  },
  {
    id: 'mode-toggle',
    anchor: '[data-tour="mode-toggle"]',
    placement: 'bottom',
    title: { zh: '视频 / GIF 切换', en: 'Video / GIF toggle' },
    body: {
      zh: '顶部这个开关切两种输出：🎬 视频 = 有配音 + 背景音乐 + 长时长，导出 MP4；🎞️ GIF = 无声 + 短循环，直出 GIF（发微信/X/群最方便）。现在我们用视频。',
      en: 'Top switch toggles output: 🎬 Video = voice + BGM + longer, exports MP4; 🎞️ GIF = silent short loop, exports GIF (best for chat/social). We\'ll use Video now.',
    },
    demo: null,
  },
  {
    id: 'add-combo',
    anchor: '[data-tour="btn-add-combo"]',
    placement: 'right',
    title: { zh: '加第一个「配套」', en: 'Add your first combo' },
    body: {
      zh: '左栏「素材 → 配套」里点一个，会一次性放进「熊猫头 + 表情」两个图层，这就是你的主角。\n\n试试点一个配套，主角就上画板了。',
      en: 'In Material → Combo, click one to drop a panda head + face as two layers — that\'s your star.\n\nClick a combo and your character appears on the canvas.',
    },
    demo: 'add-combo',
  },
  {
    id: 'drag-canvas',
    anchor: '[data-tour="preview-canvas"]',
    placement: 'left',
    title: { zh: '在画板上拖动 🐼', en: 'Drag it on the canvas 🐼' },
    body: {
      zh: '画板里的每个图层都能直接拖。点中会出现橙色选框 + 右下角缩放手柄。\n\n试试看：按住熊猫头往左右拖，松手就是新位置。',
      en: 'Every layer on the canvas is draggable. Selecting shows an orange frame + a resize handle (bottom-right).\n\nTry it: drag the panda left/right, release to set its position.',
    },
    demo: 'drag-layer',
  },
  {
    id: 'motion',
    anchor: '[data-tour="panel-motion"]',
    placement: 'right',
    title: { zh: '加个「动效」让它动起来 ✨', en: 'Add a motion effect ✨' },
    body: {
      zh: '点左栏「动效」。里面有入场/强调/律动/运镜/移动多组特效，点一个就加到选中图层的特效轨上。\n\n还有「变脸」🎭—多个表情轮播切换，整活神器。\n\n试试点一个律动（上下浮 / 摇摆）看它动。',
      en: 'Click Motion. Groups: entrance / emphasis / rhythm / camera / move — click one to add it to the selected layer\'s FX track.\n\nThere\'s also Face-cycle 🎭 — cycles through expressions. A killer move.\n\nTry a rhythm one (bob / sway) and watch it animate.',
    },
    demo: 'click-motion',
  },
  {
    id: 'caption',
    anchor: '[data-tour="panel-caption"]',
    placement: 'right',
    title: { zh: '配字幕 💬', en: 'Add captions 💬' },
    body: {
      zh: '点「字幕」加文字。可以一键随机沙雕文案，也能自己打字。字号会自适应，长了自动缩、短了放大。字幕也能在画板上拖位置 + 拖右下角手柄改大小。',
      en: 'Click Captions to add text. One-click random meme lines, or type your own. Font auto-fits (shrinks if long, grows if short). Captions are also draggable + resizable on the canvas.',
    },
    demo: null,
  },
  {
    id: 'audio',
    anchor: '[data-tour="panel-voice"]',
    placement: 'right',
    title: { zh: '配音 + 音乐 (可选) 🎙🎵', en: 'Voice + music (optional) 🎙🎵' },
    body: {
      zh: '「配音」给字幕配真人 AI 朗读（晓晓/云健等音色，导出能录进 MP4）；旁边「音乐」加背景音乐。\n\n纯整图不想要声音？跳过就行，这俩可选。',
      en: 'Voice reads your captions with real AI voices (recorded into the MP4); Music next to it adds BGM.\n\nDon\'t need sound? Skip — both are optional.',
    },
    demo: null,
  },
  {
    id: 'timeline',
    anchor: '[data-tour="timeline"]',
    placement: 'top',
    title: { zh: '时间轴 — 控制时间 ⏱', en: 'Timeline — control timing ⏱' },
    body: {
      zh: '底部时间轴每个片段都能拖：拖中间挪位置、拖两边改时长。游标拖动就能预览任意时刻。\n\n想整段变长/变短？拖最右边的「时长手柄」。',
      en: 'Each clip on the bottom timeline is draggable: drag the middle to move, the edges to trim. Drag the playhead to scrub any moment.\n\nTo lengthen/shorten the whole thing, drag the duration handle on the far right.',
    },
    demo: null,
  },
  {
    id: 'export',
    anchor: '[data-tour="btn-export"]',
    placement: 'bottom',
    title: { zh: '导出！🎉', en: 'Export! 🎉' },
    body: {
      zh: '满意了就点「导出视频」生成 MP4（手机也能导）。想要循环 GIF？回顶部切到 🎞️ GIF 再导出。',
      en: 'Happy? Hit Export to render an MP4 (works on phones too). Want a looping GIF? Switch to 🎞️ GIF up top and export.',
    },
    demo: null,
  },
  {
    id: 'done',
    anchor: '[data-tour="guide-button"]',
    placement: 'bottom',
    title: { zh: '搞定，开整吧 🐼', en: 'All set — go play 🐼' },
    body: {
      zh: '想再看一遍？随时点这个「新手引导」按钮重放。\n\n再提醒一次：左栏「上传」能传你自己的图做二创，截个图就能玩。祝你整活愉快！',
      en: 'Want a replay? Hit this Guide button anytime.\n\nReminder: the Upload tab lets you bring your own images to remix — screenshot anything and go. Have fun!',
    },
    demo: null,
  },
];

// ============================================================
// GIF 视图步骤 (~7 步) — 对照 gifmode.tsx, 主题 Win7 Aero, 强调「循环 / 无缝 / 变脸」
//   左栏 3 段: 素材(配套/熊猫/表情/场景/草图/上传/联网搜) · 字幕 · 动效 (无 音乐/配音)
//   底部循环时间轴 (am-tl-* 复用) + 循环方式 badge + 时长手柄
// ============================================================
export const DEFAULT_GIF_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    title: { zh: '欢迎来做循环 GIF 🎞️', en: 'Welcome to looping GIF 🎞️' },
    body: {
      zh: '这里专做「会循环的熊猫头 GIF」— 无声、小巧、发微信/X/群秒发。3 分钟做一个你的第一个循环。\n\n💡 「上传」能传你自己的图二创：截图、梗图直接当素材。',
      en: 'This makes looping panda GIFs — silent, tiny, perfect for chat/social. Make your first loop in 3 minutes.\n\n💡 The Upload tab takes your own images to remix: screenshots, memes, anything.',
    },
    demo: null,
  },
  {
    id: 'mode-toggle',
    anchor: '[data-tour="mode-toggle"]',
    placement: 'bottom',
    title: { zh: '现在在 GIF 模式', en: 'You\'re in GIF mode' },
    body: {
      zh: '顶部开关现在停在 🎞️ GIF：无声、短时长、循环直出。想要带配音+音乐的长视频？切回 🎬 视频即可。旁边还能选 GIF 尺寸预设 + 时长。',
      en: 'Top switch is on 🎞️ GIF: silent, short, loop output. Want a longer video with voice + music? Switch back to 🎬 Video. Next to it: GIF size preset + duration.',
    },
    demo: null,
  },
  {
    id: 'add-combo',
    anchor: '[data-tour="btn-add-combo"]',
    placement: 'right',
    title: { zh: '加「配套」当主角', en: 'Add a combo as your star' },
    body: {
      zh: '左栏「素材 → 配套」点一个，放进「熊猫头 + 表情」两层。表情会自动跟随熊猫头壳，壳怎么动脸就怎么动。\n\n点一个试试。',
      en: 'In Material → Combo, click one to add a panda shell + face. The face auto-follows the shell — move the shell, the face moves with it.\n\nClick one to try.',
    },
    demo: 'add-combo',
  },
  {
    id: 'drag-canvas',
    anchor: '[data-tour="preview-canvas"]',
    placement: 'left',
    title: { zh: '画板上拖一拖 🐼', en: 'Drag on the canvas 🐼' },
    body: {
      zh: '图层直接拖动摆位置，点中有橙色选框 + 缩放手柄。白底就是 GIF 实际输出范围。\n\n试试拖动熊猫头。',
      en: 'Drag layers to position them; selecting shows an orange frame + resize handle. The white area is the GIF\'s actual output frame.\n\nTry dragging the panda head.',
    },
    demo: 'drag-layer',
  },
  {
    id: 'motion',
    anchor: '[data-tour="panel-motion"]',
    placement: 'right',
    title: { zh: '循环动效 — GIF 的灵魂 ✨', en: 'Loop motion — the soul of a GIF ✨' },
    body: {
      zh: '点「动效」给选中图层套一个会循环的鬼畜动作（上下浮/摇摆/横跳…），首尾自动接得上，这就是 GIF 动起来的关键。\n\n还有「变脸」🎭—多表情轮播。点一个动作看它循环。',
      en: 'Click Motion to give the layer a looping action (bob / sway / hop…) — seamlessly cycling, this is what makes the GIF move.\n\nThere\'s Face-cycle 🎭 too. Click an action and watch it loop.',
    },
    demo: 'click-motion',
  },
  {
    id: 'caption',
    anchor: '[data-tour="panel-caption"]',
    placement: 'right',
    title: { zh: '加字幕 💬', en: 'Add captions 💬' },
    body: {
      zh: '点「字幕」加文字，一键随机沙雕文案或自己打。字号自适应，画板上能拖位置 + 拖手柄改大小。',
      en: 'Click Captions for text — random meme lines or your own. Font auto-fits; drag to position + resize on the canvas.',
    },
    demo: null,
  },
  {
    id: 'timeline-loop',
    anchor: '[data-tour="duration-handle"]',
    placement: 'top',
    title: { zh: '循环时间轴 + 无缝 🔁', en: 'Loop timeline + seamless 🔁' },
    body: {
      zh: '底部是循环时间轴。拖最右「时长手柄」改一圈多长；右上角「循环方式」徽章点一下切 直接/乒乓 — 乒乓正放→倒放来回, 任何素材都首尾无缝。',
      en: 'The bottom is the loop timeline. Drag the rightmost duration handle to change loop length (drag left to shorten, right to lengthen); click the loop-mode badge (top-right) to toggle direct / boomerang — boomerang plays forward then back, seamless for any material.',
    },
    demo: null,
  },
  {
    id: 'export',
    anchor: '[data-tour="btn-export"]',
    placement: 'bottom',
    title: { zh: '导出 GIF 🎉', en: 'Export GIF 🎉' },
    body: {
      zh: '点「导出 GIF」直接生成可循环的 .gif（手机也能导）。还能用「对比变体」一次看 直接/乒乓 哪个最顺再挑。',
      en: 'Hit Export GIF for a ready looping .gif (phones too). Use Compare to see direct / boomerang side by side and pick the smoothest.',
    },
    demo: null,
  },
  {
    id: 'done',
    anchor: '[data-tour="guide-button"]',
    placement: 'bottom',
    title: { zh: '完成，去整活 🐼', en: 'Done — go create 🐼' },
    body: {
      zh: '想重看引导？点这个「新手引导」按钮随时重放。别忘了「上传」能传你自己的图做二创。开循环愉快！',
      en: 'Replay anytime via this Guide button. Don\'t forget Upload brings your own images to remix. Happy looping!',
    },
    demo: null,
  },
];
