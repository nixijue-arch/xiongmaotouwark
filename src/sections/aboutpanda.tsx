import { useMemo, useState } from 'react';
import { useMeme } from '@/context/memecontext';
import { MUSEUM_IMAGES } from '@/data/museum-images';
import {
  ArrowLeft,
  BookOpen,
  Clock3,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react';

type OriginCard = {
  year: string;
  title: string;
  desc: string;
  sticker: string;
  accent?: 'gold' | 'blue';
};

type EvolutionCard = {
  year: string;
  title: string;
  desc: string;
  sticker: string;
};

const ORIGIN_ZH: OriginCard[] = [
  {
    year: '2010',
    title: '阿拉伯熊猫入侵',
    desc: 'ArabDairy 的魔性广告把“拒绝就发疯”的熊猫形象带进中文互联网，软萌外表配上暴躁反差，迅速成了造梗土壤。',
    sticker: '!?',
    accent: 'blue',
  },
  {
    year: '2010-2012',
    title: '万恶之源：金馆长 + 熊猫头',
    desc: '贴吧好友把金馆长笑脸 P 到熊猫身上，再配上“刚子 is watching you”，私密玩笑意外长成后来的国民表情母体。',
    sticker: 'WATCHING YOU',
    accent: 'gold',
  },
  {
    year: '2012+',
    title: '从爆红到经典',
    desc: '它从朋友之间的斗图黑话，一路演变成横跨贴吧、QQ、微信、微博和短视频平台的通用情绪容器。',
    sticker: '❤',
    accent: 'blue',
  },
];

const ORIGIN_EN: OriginCard[] = [
  {
    year: '2010',
    title: 'Arab Panda Arrives',
    desc: 'An ArabDairy commercial introduced a cute-but-unhinged panda archetype that Chinese meme culture quickly adopted and remixed.',
    sticker: '!?',
    accent: 'blue',
  },
  {
    year: '2010-2012',
    title: 'Kim + Panda: Origin Core',
    desc: 'Friends on early message boards pasted Kim’s iconic laughing face onto the panda and paired it with “Gangzi is watching you,” turning an inside joke into a reusable meme template.',
    sticker: 'WATCHING YOU',
    accent: 'gold',
  },
  {
    year: '2012+',
    title: 'From Viral to Classic',
    desc: 'What began as private banter spread across forums, chat apps, and social platforms, eventually becoming a shared visual language for reactions online.',
    sticker: '❤',
    accent: 'blue',
  },
];

const EVOLUTION_ZH: EvolutionCard[] = [
  {
    year: '2010-2014',
    title: '贴吧起源',
    desc: '熊猫头+金馆长脸模板诞生，“上面换脸下面台词”的静态格式成型。',
    sticker: '💬',
  },
  {
    year: '2015-2018',
    title: '社交平台传播',
    desc: '微博、QQ 空间、微信朋友圈疯狂转发，衍生出大量新梗和分支表情。',
    sticker: '❤',
  },
  {
    year: '2019-2023',
    title: '沙雕宇宙扩张',
    desc: '短视频、直播、B站齐爆发，角色化、剧情化、宇宙化表达快速成熟。',
    sticker: '🎬',
  },
  {
    year: '2024+',
    title: 'AI表情工坊时代',
    desc: 'AI 生成、动态表情、链上版权与创作社区并行，熊猫头正式迈进 Meme 3.0。',
    sticker: '神！',
  },
];

const EVOLUTION_EN: EvolutionCard[] = [
  {
    year: '2010-2014',
    title: 'Forum Origin',
    desc: 'The panda-plus-Kim template took shape, establishing the classic static meme format: image on top, caption underneath.',
    sticker: '💬',
  },
  {
    year: '2015-2018',
    title: 'Social Spread',
    desc: 'Chat groups and mainstream social platforms accelerated distribution, producing countless remixes, captions, and spin-off characters.',
    sticker: '❤',
  },
  {
    year: '2019-2023',
    title: 'Silly Universe',
    desc: 'Short-video culture and creator communities turned panda memes into recurring characters, mini-stories, and full chaotic universes.',
    sticker: '🎬',
  },
  {
    year: '2024+',
    title: 'AI Workshop Era',
    desc: 'AI tools, animated stickers, and creator communities pushed panda memes into a new phase of faster, more programmable remix culture.',
    sticker: 'WOW',
  },
];

export function AboutPanda({ onBack }: { onBack: () => void }) {
  const { state } = useMeme();
  const lang = state.language;
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const originCards = lang === 'zh' ? ORIGIN_ZH : ORIGIN_EN;
  const evolutionCards = lang === 'zh' ? EVOLUTION_ZH : EVOLUTION_EN;

  const originImages = useMemo(() => {
    return ['set1-2.png', 'set1-3.png', 'set1-4.png'].map((file) => `/museum/${file}`);
  }, []);

  const evolutionImages = useMemo(() => {
    return ['set1-5.png', 'set1-6.png', 'set1-7.png', 'set1-8.png'].map((file) => `/museum/${file}`);
  }, []);

  const gallery = useMemo(() => {
    return [
      'set2-1.png',
      'set2-2.png',
      'set2-3.png',
      'set2-4.png',
      'set2-5.png',
      'set2-6.png',
      'set2-7.png',
      'set2-8.png',
      'set2-9.png',
      'set1-10.png',
    ].map((file) => `/museum/${file}`);
  }, []);

  return (
    <div className="about-container about-arcade-shell">
      <div className="about-page">
        <section className="about-marquee">
          <div className="about-marquee-brand">
            <div className="about-marquee-logo">
              <img src="/site-logo.png" alt="Panda Meme Lab" />
            </div>
            <div className="about-marquee-copy">
              <h1>{lang === 'zh' ? '熊猫头' : 'PANDA HEAD'}</h1>
              <p>MEME-LAB</p>
            </div>
          </div>

          <div className="about-marquee-slogan">
            <span>{lang === 'zh' ? '做表情，不内卷！' : 'MAKE MEMES, NOT WAR'}</span>
            <small>{lang === 'zh' ? '人人都是表情包之王。' : 'Everyone can build the next classic.'}</small>
          </div>

        </section>

        <section className="about-subnav">
          <div className="about-subnav-left">
            <span>{lang === 'zh' ? '表情工坊 - V2.0' : 'Meme Workshop - V2.0'}</span>
            <span>{lang === 'zh' ? 'PANDAS DEPLOYED' : 'PANDAS DEPLOYED'}</span>
          </div>
          <div className="about-subnav-right">
            <span>{lang === 'zh' ? 'POWERED BY VIBES' : 'POWERED BY VIBES'}</span>
          </div>
        </section>

        <section className="about-banner-card">
          <div className="about-banner-main">
            <div className="about-banner-icon">
              <img src="/site-logo.png" alt="" />
            </div>
            <div>
              <h2>{lang === 'zh' ? '熊猫头起源档案' : 'Panda Head Origin Archive'}</h2>
              <p>{lang === 'zh' ? '追溯熊猫头表情包的诞生与进化' : 'Trace the birth and evolution of panda head memes'}</p>
            </div>
          </div>
          <button onClick={onBack} className="about-back-btn about-arcade-btn">
            <ArrowLeft size={16} />
            <span>{lang === 'zh' ? '返回工坊' : 'Back to Studio'}</span>
          </button>
        </section>

        <section className="about-panel">
          <div className="about-panel-title">
            <span className="about-panel-badge"><Sparkles size={18} /></span>
            <h3>{lang === 'zh' ? '起源' : 'Origin'}</h3>
          </div>

          <div className="about-origin-grid">
            {originCards.map((card, index) => (
              <article key={card.title} className={`about-origin-card about-origin-${card.accent ?? 'blue'}`}>
                <div className="about-origin-topline">
                  <span className="about-chip">{card.year}</span>
                  <span className="about-sticker">{card.sticker}</span>
                </div>
                <div className="about-origin-body">
                  <div className="about-origin-copy">
                    <h4>{card.title}</h4>
                    <p>{card.desc}</p>
                  </div>
                  <div className="about-origin-figure">
                    <img src={originImages[index] ?? '/site-logo.png'} alt={card.title} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="about-panel">
          <div className="about-panel-title">
            <span className="about-panel-badge"><Clock3 size={18} /></span>
            <h3>{lang === 'zh' ? '演变历程' : 'Evolution'}</h3>
            <p>{lang === 'zh' ? '从静态表情到“沙雕宇宙”的进化之路' : 'From static meme to full silly universe'}</p>
          </div>

          <div className="about-timeline-row">
            {evolutionCards.map((card, index) => (
              <div key={card.title} className="about-evolution-wrap">
                <article className="about-evolution-card">
                  <span className="about-chip">{card.year}</span>
                  <div className="about-evolution-content">
                    <img src={evolutionImages[index] ?? '/site-logo.png'} alt={card.title} className="about-evolution-thumb" />
                    <div>
                      <h4>{card.title}</h4>
                      <p>{card.desc}</p>
                    </div>
                  </div>
                  <span className="about-evolution-sticker">{card.sticker}</span>
                </article>
                {index < evolutionCards.length - 1 && <div className="about-evolution-arrow">➜</div>}
              </div>
            ))}
          </div>
        </section>

        <section className="about-panel about-gallery-panel">
          <div className="about-panel-title">
            <span className="about-panel-badge"><BookOpen size={18} /></span>
            <h3>{lang === 'zh' ? '档案陈列' : 'Archive Showcase'}</h3>
            <p>{lang === 'zh' ? '点击查看代表性熊猫头样本' : 'Tap to inspect representative panda meme samples'}</p>
          </div>

          <div className="about-gallery-grid">
            {gallery.map((image, index) => (
              <button
                key={image}
                className="about-gallery-card"
                onClick={() => setSelectedImage(image)}
                type="button"
              >
                <img src={image} alt={`Panda meme ${index + 1}`} />
                <span>NO.{index + 1}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="about-info-grid">
          <article className="about-info-card">
            <div className="about-panel-title about-panel-title-left">
              <span className="about-panel-badge"><Trophy size={18} /></span>
              <h3>{lang === 'zh' ? '为什么能封神' : 'Why It Endures'}</h3>
            </div>
            <ul className="about-bullet-list">
              <li>{lang === 'zh' ? '低门槛：一张底图、几句台词，就能立刻开工。' : 'Low barrier: one base image and a short caption are enough to start.'}</li>
              <li>{lang === 'zh' ? '高延展：可以不断嫁接新热点、新明星、新事件。' : 'High extensibility: it absorbs every new trend, celebrity, and event.'}</li>
              <li>{lang === 'zh' ? '高匿名：替你说狠话、怪话、委屈话。' : 'High anonymity: it says what users cannot easily say directly.'}</li>
              <li>{lang === 'zh' ? '高情绪效率：一张图顶十句废话。' : 'High emotional efficiency: one image can replace ten lines of text.'}</li>
            </ul>
          </article>

          <article className="about-info-card about-info-card-highlight">
            <div className="about-panel-title about-panel-title-left">
              <span className="about-panel-badge"><Swords size={18} /></span>
              <h3>{lang === 'zh' ? '战绩面板' : 'Status Panel'}</h3>
            </div>
            <div className="about-stat-grid">
              <div>
                <strong>15+</strong>
                <span>{lang === 'zh' ? '年发展史' : 'Years'}</span>
              </div>
              <div>
                <strong>10亿+</strong>
                <span>{lang === 'zh' ? '搜索热度' : 'Search Heat'}</span>
              </div>
              <div>
                <strong>∞</strong>
                <span>{lang === 'zh' ? '二创分身' : 'Remixes'}</span>
              </div>
              <div>
                <strong>114,514</strong>
                <span>{lang === 'zh' ? '在线共鸣' : 'Live Resonance'}</span>
              </div>
            </div>
          </article>
        </section>

      </div>

      {selectedImage && (
        <div className="about-gallery-lightbox" onClick={() => setSelectedImage(null)}>
          <div className="about-gallery-lightbox-content" onClick={(event) => event.stopPropagation()}>
            <button className="about-gallery-lightbox-close" onClick={() => setSelectedImage(null)} type="button">
              ×
            </button>
            <img src={selectedImage} alt="Panda meme preview" />
          </div>
        </div>
      )}
    </div>
  );
}
