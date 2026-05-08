import { useState, useEffect, useRef } from 'react';
import { useMeme } from '@/context/memecontext';
import { MUSEUM_IMAGES } from '@/data/museum-images';
import { X, ArrowLeft, Sparkles, Clock, Zap, Crown, Globe, Smile, Heart, MessageCircle, Share2, TrendingUp, User, Palette, Scroll, Play } from 'lucide-react';

/* ── Scroll Reveal Hook ── */
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setRevealed(true); obs.unobserve(el); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, revealed };
}

/* ── Hero ── */
function HeroSection({ onBack }: { onBack: () => void }) {
  const { state } = useMeme();
  const lang = state.language;
  // Pick 12 random memes for background grid
  const bgImages = MUSEUM_IMAGES.slice(0, 12);

  return (
    <section className="about-hero">
      {/* Background grid */}
      <div className="about-hero-bg">
        {bgImages.map((f, i) => (
          <div key={f} className="about-hero-bg-item" style={{ animationDelay: `${i * 0.2}s` }}>
            <img src={`/museum/${f}`} alt="" loading="lazy" />
          </div>
        ))}
        <div className="about-hero-overlay" />
      </div>

      <div className="about-hero-content">
        <button onClick={onBack} className="about-back-btn">
          <ArrowLeft size={16} />
          <span>{lang === 'zh' ? '返回' : 'Back'}</span>
        </button>

        <div className="about-hero-badge">
          <Sparkles size={14} />
          <span>{lang === 'zh' ? '中文互联网第一表情' : '#1 Meme in Chinese Internet'}</span>
        </div>

        <h1 className="about-hero-title">
          {lang === 'zh' ? '熊猫头表情包' : 'Panda Head Meme'}
        </h1>
        <p className="about-hero-subtitle">
          {lang === 'zh'
            ? '中文互联网的"通用语" · 从一次贴吧好友间的无心调侃到国民级文化符号'
            : 'The "Universal Language" of Chinese Internet · From a casual joke between forum friends to a national cultural symbol'
          }
        </p>

        <div className="about-hero-stats">
          <div className="about-stat">
            <Clock size={18} />
            <span className="about-stat-num">15+</span>
            <span className="about-stat-label">{lang === 'zh' ? '年发展历程' : 'Years'}</span>
          </div>
          <div className="about-stat">
            <TrendingUp size={18} />
            <span className="about-stat-num">10亿+</span>
            <span className="about-stat-label">{lang === 'zh' ? '百度搜索结果' : 'Search Results'}</span>
          </div>
          <div className="about-stat">
            <Share2 size={18} />
            <span className="about-stat-num">∞</span>
            <span className="about-stat-label">{lang === 'zh' ? '跨平台流通' : 'Cross-platform'}</span>
          </div>
        </div>

        <div className="about-hero-scroll">
          <span>{lang === 'zh' ? '向下滚动探索' : 'Scroll to explore'}</span>
          <div className="about-scroll-arrow" />
        </div>
      </div>
    </section>
  );
}

/* ── Origin Story ── */
function OriginSection() {
  const { state } = useMeme();
  const lang = state.language;
  const { ref, revealed } = useReveal();

  return (
    <section className="about-section about-origin" ref={ref}>
      <div className={`about-content ${revealed ? 'revealed' : ''}`}>
        <div className="about-section-header">
          <div className="about-section-icon"><Zap size={20} /></div>
          <h2 className="about-section-title">{lang === 'zh' ? '起源' : 'Origin'}</h2>
          <p className="about-section-subtitle">{lang === 'zh' ? '一次贴吧好友间的无心调侃' : 'A Casual Joke Between Forum Friends'}</p>
        </div>

        <div className="about-origin-grid">
          <div className="about-origin-card">
            <div className="about-origin-year">2010</div>
            <h3>{lang === 'zh' ? '阿拉伯熊猫入侵' : 'Arab Panda Invasion'}</h3>
            <p>{lang === 'zh'
              ? '埃及乳制品公司 ArabDairy 制作了一支魔性广告《Never say no to panda》，片中一只软萌的大熊猫在被拒绝后会瞬间"黑化"搞破坏，这个形象随后被引入中国互联网。'
              : 'Egyptian dairy company ArabDairy created the viral ad "Never Say No to Panda." A cute panda would instantly turn destructive when rejected, and this image was later introduced to Chinese internet.'}
            </p>
          </div>

          <div className="about-origin-card about-origin-highlight">
            <div className="about-origin-year">2010-2012</div>
            <h3>{lang === 'zh' ? '万恶之源：金馆长 + 熊猫头' : 'The "Source of All Evil": Kim + Panda'}</h3>
            <p>{lang === 'zh'
              ? '百度"暗黑破坏神"贴吧吧友"刚子"对这只熊猫情有独钟。他的好友、美术专业出身的"毕须博须A"（毕老师）为调侃刚子，PS了一张"金馆长笑脸"替换熊猫脸部，配上文字"刚子 is watching you"。2012年刚子因病去世，这只尚未火出圈的表情包成了朋友们悼念他的特殊纽带。'
              : 'Forum user "Gangzi" loved this panda. His artist friend "Bixuboxu A" (Teacher Bi) photoshopped Korean comedy star Kim\'s face onto the panda with the caption "Gangzi is watching you." After Gangzi passed away in 2012, the meme became a special bond among friends. Nobody expected it to become a national phenomenon years later.'}
            </p>
          </div>

          <div className="about-origin-card">
            <div className="about-origin-year">2012+</div>
            <h3>{lang === 'zh' ? '从爆红到经典' : 'From Viral Fame to Classic Status'}</h3>
            <p>{lang === 'zh'
              ? '没人想到，几年后这只熊猫头会成为红遍中文网络的国民表情包。它从朋友间的私人玩笑，逐渐演变为全网通用的情绪表达工具。'
              : 'No one expected this private joke between friends to evolve into a universal emotional expression tool across the entire Chinese internet years later.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Timeline ── */
const TIMELINE_ZH = [
  { year: '2010-2014', title: '贴吧起源', desc: '熊猫头+金馆长脸模板诞生，"上面换脸下面台词"的静态图片形态确立。', tags: ['静态', '贴吧', '换脸'] },
  { year: '2014-2016', title: '全面流行', desc: '从贴吧扩散至QQ、微信，衍生出"熊猫人"等变体，表情更加多元。', tags: ['QQ', '微信', '熊猫人'] },
  { year: '2016-2018', title: '黄金发展期', desc: '"沙雕文化"兴起，熊猫头成为核心符号，蘑菇头、张学友等加入换脸大军。', tags: ['沙雕', '蘑菇头', '张学友'] },
  { year: '2018-2020', title: '沙雕动画元年', desc: 'B站、抖音出现大量以熊猫人为主角的自制动画，阿幕降临等UP主将其推向新高度。', tags: ['B站', '抖音', '动画'] },
  { year: '2020至今', title: '全民创作时代', desc: '沙雕动画生成器出现，"有手就会"的教程泛滥，创作工具平民化，内容高度内卷。', tags: ['生成器', '平民化', '内卷'] },
];

const TIMELINE_EN = [
  { year: '2010-2014', title: 'Forum Origin', desc: 'The panda head + Kim face template was born. The static "face on top, caption below" format was established.', tags: ['Static', 'Forum', 'Face-swap'] },
  { year: '2014-2016', title: 'Mainstream Spread', desc: 'Spread from forums to QQ and WeChat. Variants like "Panda Man" emerged, making expressions more diverse.', tags: ['QQ', 'WeChat', 'Panda Man'] },
  { year: '2016-2018', title: 'Golden Era', desc: '"Silly culture" rose. Panda head became the core symbol. Mushroom head, Jacky Cheung and others joined the face-swap army.', tags: ['Silly', 'Mushroom', 'Cheung'] },
  { year: '2018-2020', title: 'Animation Boom', desc: 'Bilibili and TikTok saw a surge of self-made animations starring Panda Man. Creators like "Amu" pushed it to new heights.', tags: ['Bilibili', 'TikTok', 'Animation'] },
  { year: '2020-Present', title: 'Mass Creation', desc: 'Silly animation generators emerged. "Anyone can do it" tutorials flooded. Creation tools became accessible to all.', tags: ['Generator', 'Accessible', 'Era'] },
];

function TimelineSection() {
  const { state } = useMeme();
  const lang = state.language;
  const items = lang === 'zh' ? TIMELINE_ZH : TIMELINE_EN;
  const { ref, revealed } = useReveal();

  return (
    <section className="about-section about-timeline" ref={ref}>
      <div className={`about-content ${revealed ? 'revealed' : ''}`}>
        <div className="about-section-header">
          <div className="about-section-icon"><Clock size={20} /></div>
          <h2 className="about-section-title">{lang === 'zh' ? '演变历程' : 'Evolution'}</h2>
          <p className="about-section-subtitle">{lang === 'zh' ? '从静态表情到"沙雕宇宙"' : 'From Static Meme to "Silly Universe"'}</p>
        </div>

        <div className="about-timeline-track">
          {items.map((item, i) => (
            <div
              key={item.year}
              className={`about-timeline-node ${i % 2 === 0 ? 'left' : 'right'}`}
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              <div className="about-timeline-dot" />
              <div className="about-timeline-card">
                <div className="about-timeline-year">{item.year}</div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="about-timeline-tags">
                  {item.tags.map(t => <span key={t} className="about-timeline-tag">{t}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Gallery Wall (static showcase) ── */
function GalleryWall() {
  const { state } = useMeme();
  const lang = state.language;
  const { ref, revealed } = useReveal();
  const [lightbox, setLightbox] = useState<string | null>(null);

  // 精选 24 张代表表情包均匀分布
  const gallery = MUSEUM_IMAGES.filter((_, i) => MUSEUM_IMAGES.length <= 24 || i % Math.ceil(MUSEUM_IMAGES.length / 24) === 0).slice(0, 24);

  return (
    <section className="about-section about-gallery" ref={ref}>
      <div className={`about-content ${revealed ? 'revealed' : ''}`}>
        <div className="about-section-header">
          <div className="about-section-icon"><Palette size={20} /></div>
          <h2 className="about-section-title">{lang === 'zh' ? '表情包宇宙' : 'Meme Universe'}</h2>
          <p className="about-section-subtitle">
            {lang === 'zh' ? '精选表情包展示' : 'Featured meme showcase'}
          </p>
        </div>

        <div className="about-gallery-static">
          {gallery.map((f) => (
            <div
              key={f}
              className="about-gallery-static-item"
              onClick={() => setLightbox(`/museum/${f}`)}
            >
              <img src={`/museum/${f}`} alt="meme" loading="lazy" />
            </div>
          ))}
        </div>

        {/* Lightbox */}
        {lightbox && (
          <div className="about-gallery-lightbox" onClick={() => setLightbox(null)}>
            <div className="about-gallery-lightbox-content" onClick={e => e.stopPropagation()}>
              <button className="about-gallery-lightbox-close" onClick={() => setLightbox(null)}>
                <X size={20} />
              </button>
              <img src={lightbox} alt="panda meme" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Status / Position ── */
const STATUS_CARDS_ZH = [
  { icon: <Crown size={24} />, title: '表情包三巨头继承者', desc: '姚明、金馆长、花泽香菜之后，熊猫头完成了从"真人表情包"到"可无限改造的模板"的跃迁，把各种明星名场面都纳入自己的"身体"。' },
  { icon: <Zap size={24} />, title: '超表情包代表', desc: '不只是模拟面部表情，而是包含面部表情+体态动作+故事语境的完整叙事单元。一张图能同时传递情绪、动作和环境氛围。' },
  { icon: <Globe size={24} />, title: '中文互联网通用语', desc: '情绪通用、平台通用、代际通用、场景通用。从斗图到吐槽、从撒娇到讽刺、从吃瓜到凡尔赛……无所不能。' },
  { icon: <Smile size={24} />, title: '沙雕文化图腾', desc: '2018"沙雕元年"的视觉符号，代表以戏谑消解严肃、以自嘲对抗压力的互联网精神。年轻人藏身于这张面孔背后寻找栖息地。' },
];

const STATUS_CARDS_EN = [
  { icon: <Crown size={24} />, title: 'Heir to the Big Three', desc: 'After Yao Ming, Kim, and Kana Hanazawa, panda head completed the leap from "real-person meme" to "infinitely modifiable template", absorbing every celebrity moment into its body.' },
  { icon: <Zap size={24} />, title: 'Hyper-meme Representative', desc: 'Not just facial expression simulation, but a complete narrative unit including facial expression + body posture + story context. One image conveys emotion, action and atmosphere simultaneously.' },
  { icon: <Globe size={24} />, title: 'Universal Language', desc: 'Universal in emotion, platform, generation, and scenario. From meme battles to complaints, from coquetry to sarcasm, from gossiping to humble-bragging... nothing is impossible.' },
  { icon: <Smile size={24} />, title: 'Totem of Silly Culture', desc: 'The visual symbol of the 2018 "Silly Year", representing an internet spirit of dissolving seriousness through banter and fighting pressure through self-mockery. Young people find shelter behind this face.' },
];

function StatusSection() {
  const { state } = useMeme();
  const lang = state.language;
  const cards = lang === 'zh' ? STATUS_CARDS_ZH : STATUS_CARDS_EN;
  const { ref, revealed } = useReveal();

  return (
    <section className="about-section about-status" ref={ref}>
      <div className={`about-content ${revealed ? 'revealed' : ''}`}>
        <div className="about-section-header">
          <div className="about-section-icon"><Crown size={20} /></div>
          <h2 className="about-section-title">{lang === 'zh' ? '地位与影响' : 'Status & Influence'}</h2>
          <p className="about-section-subtitle">{lang === 'zh' ? '熊猫头在中文互联网Meme中的独特位置' : 'The unique position of Panda Head in Chinese internet meme culture'}</p>
        </div>

        <div className="about-status-grid">
          {cards.map((card, i) => (
            <div key={i} className="about-status-card" style={{ animationDelay: `${i * 0.12}s` }}>
              <div className="about-status-icon">{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Why Longevity ── */
const WHY_CARDS_ZH = [
  { icon: <Palette size={20} />, title: '低门槛+高上限', desc: '一个修图软件、一只熊猫头底图，简单涂鸦拼贴就能创作，同时也能支撑复杂的动画叙事。' },
  { icon: <User size={20} />, title: '匿名性保护', desc: '熊猫头是一张"面具"，使用者可以借它表达真实生活中不敢表达的情绪，获得安全的宣泄出口。' },
  { icon: <Share2 size={20} />, title: '模因进化优势', desc: '作为模板，它能不断吸收新的流行元素（新梗、新明星、新事件），实现自我更新，永不过时。' },
  { icon: <Heart size={20} />, title: '情感代偿', desc: '在越来越"卷"的互联网环境中，熊猫头提供了一种廉价但有效的情绪宣泄出口，成为年轻人的精神栖息地。' },
];

const WHY_CARDS_EN = [
  { icon: <Palette size={20} />, title: 'Low Barrier + High Ceiling', desc: 'A simple image editor and a panda head template are all you need to create, yet it can also support complex animated narratives.' },
  { icon: <User size={20} />, title: 'Anonymity Shield', desc: 'The panda head is a "mask" that lets users express emotions they dare not show in real life, providing a safe venting outlet.' },
  { icon: <Share2 size={20} />, title: 'Meme Evolution Edge', desc: 'As a template, it constantly absorbs new trending elements (new jokes, celebrities, events), achieving self-renewal and timelessness.' },
  { icon: <Heart size={20} />, title: 'Emotional Substitute', desc: 'In an increasingly competitive internet environment, panda head provides a cheap but effective emotional outlet, becoming a spiritual habitat for young people.' },
];

function WhySection() {
  const { state } = useMeme();
  const lang = state.language;
  const cards = lang === 'zh' ? WHY_CARDS_ZH : WHY_CARDS_EN;
  const { ref, revealed } = useReveal();

  return (
    <section className="about-section about-why" ref={ref}>
      <div className={`about-content ${revealed ? 'revealed' : ''}`}>
        <div className="about-section-header">
          <div className="about-section-icon"><TrendingUp size={20} /></div>
          <h2 className="about-section-title">{lang === 'zh' ? '为什么长盛不衰？' : 'Why Does It Last?'}</h2>
        </div>

        <div className="about-why-grid">
          {cards.map((card, i) => (
            <div key={i} className="about-why-card" style={{ animationDelay: `${i * 0.12}s` }}>
              <div className="about-why-icon">{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Footer Quote ── */
function QuoteFooter({ onBack }: { onBack: () => void }) {
  const { state } = useMeme();
  const lang = state.language;
  const [quoteIdx, setQuoteIdx] = useState(0);

  const quotesZh = [
    '不存熊猫头，无以水群。',
    '给熊猫头涂上蓝色泪水它就哭了。',
    '它模糊抽象的面部自带几分"猥琐气质"。',
    '你永远猜不出它的含义，搭配任何文字都不违和。',
    '在真实生活的附近，获得了一处栖息地。',
  ];
  const quotesEn = [
    '"No panda head, no group chat."',
    'Paint blue tears on the panda head and it cries.',
    'Its ambiguous face carries a natural "sleazy charm".',
    'You can never guess its meaning — it matches any text.',
    'Near real life, it provides a habitat.',
  ];
  const quotes = lang === 'zh' ? quotesZh : quotesEn;

  useEffect(() => {
    const iv = setInterval(() => setQuoteIdx(p => (p + 1) % quotes.length), 5000);
    return () => clearInterval(iv);
  }, [quotes.length]);

  return (
    <section className="about-footer">
      <div className="about-footer-memes">
        {MUSEUM_IMAGES.slice(0, 8).map((f, i) => (
          <div key={f} className="about-footer-meme" style={{ animationDelay: `${i * 0.3}s` }}>
            <img src={`/museum/${f}`} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      <div className="about-footer-content">
        <Scroll size={32} className="about-footer-scroll-icon" />
        <blockquote className="about-footer-quote">
          "{quotes[quoteIdx]}"
        </blockquote>
        <p className="about-footer-desc">
          {lang === 'zh'
            ? '熊猫头表情包从一次游戏贴吧的好友调侃出发，历经十余年演变，已经成为中文互联网最具代表性的视觉符号之一。它不仅是"斗图界顶流"，更是一种草根创作精神的结晶。'
            : 'Starting from a casual joke in a gaming forum, after more than a decade of evolution, the panda head meme has become one of the most representative visual symbols of the Chinese internet. It is not just the top meme for battles, but also the crystallization of grassroots creative spirit.'}
        </p>

        <button onClick={onBack} className="about-footer-btn">
          <Play size={16} />
          {lang === 'zh' ? '去制作熊猫头表情包' : 'Make a Panda Meme'}
        </button>

        <div className="about-footer-links">
          <a href="https://x.com/xiongmaotoubnb" target="_blank" rel="noopener noreferrer">
            <MessageCircle size={14} /> X Community
          </a>
          <span>·</span>
          <span>$熊猫头 MemeForge</span>
        </div>
      </div>
    </section>
  );
}

/* ── Main About Page ── */
export function AboutPanda({ onBack }: { onBack: () => void }) {
  return (
    <div className="about-container">
      <HeroSection onBack={onBack} />
      <OriginSection />
      <TimelineSection />
      <GalleryWall />
      <StatusSection />
      <WhySection />
      <QuoteFooter onBack={onBack} />
    </div>
  );
}
