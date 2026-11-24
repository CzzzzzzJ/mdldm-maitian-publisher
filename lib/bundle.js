// 一期视频的工程文件 publish.json：读取、校验。
// 工程目录在 NAS：/Volumes/<共享>/视频导出/<系列>/<期>/，里面放 成片.mp4、字幕.srt、封面/、publish.json。
// publish.json 里的文件路径都相对于这个目录。

import { specs as extraSpecs } from './platforms/extra-specs.js';

export const PLATFORMS = {
  bilibili: { name: 'B 站', fields: { title: [1, 80], desc: [0, 2000] }, article: { fields: { title: [1, 40], desc: [200, 20000] } }, tags: { max: 10, each: 20 }, links: true },
  xhs: { name: '小红书', fields: { title: [1, 20], body: [1, 1000] }, article: { fields: { title: [1, 20], body: [1, 20000] } }, topics: true, links: false },
  douyin: { name: '抖音', fields: { title: [1, 30], body: [0, 1000] }, images: { fields: { title: [1, 20], body: [0, 1000] } }, article: { fields: { title: [1, 30], body: [1, 8000] } }, topics: true, maxTopics: 5, links: false },
  channels: { name: '视频号', fields: { shortTitle: [6, 16], body: [0, 1000] }, topics: true, links: false },
  youtube: { name: 'YouTube', fields: { title: [1, 100], desc: [0, 5000] }, tags: { total: 500 }, links: true, noAngle: true },
  x: { name: 'X', fields: { text: [1, 25000] }, links: true },
  instagram: { name: 'Instagram', fields: { caption: [1, 2200] }, links: true, maxHashtags: 30, maxSec: 1200 },
  mp: { name: '服务号', fields: { title: [1, 64], author: [0, 8], digest: [1, 120], body: [1, 50000] }, images: { fields: { title: [1, 64], body: [1, 1000] } }, links: true },
  discord: { name: 'Discord', fields: { text: [1, 2000] }, images: { fields: { text: [1, 2000] } }, article: { fields: { text: [1, 2000] } }, links: true },
  ...extraSpecs,
};

// 普通文字频道。论坛帖、公告和消息线程的地址对不上这一个 text。
export const DISCORD_CHANNEL = /^https:\/\/discord\.com\/channels\/\d+\/\d+\/?$/;
export const DISCORD_BYTES = 10 * 1024 * 1024;

// 轮播里有单张超过普通服务器附件上限时，跳过 Discord，不拦住别的渠道。
export function noteDiscordImages(p, byteLength) {
  if (!p || p.skip || p.mode !== 'images') return;
  for (const img of p.images || []) {
    const n = byteLength(img);
    if (n > DISCORD_BYTES) { p.skip = '图片超过 Discord 普通服务器约 10MB 的附件上限'; return; }
  }
}

// 小红书、抖音、视频号：不直接引流，最多说「整理成文档了，私信我」
const LEAD = /知识站|课程站|文档库|飞书|主页.{0,8}(搜|看|找)|评论区.{0,8}(链接|领|拿)|点链接|戳链接/;

// 一种内容类型分给支持它的渠道。不在名单里的跳过。视频名单不含 Discord。
export const KINDS = {
  video: { label: '视频', platforms: ['bilibili', 'xhs', 'douyin', 'channels', 'mp', 'youtube', 'x', 'instagram', 'zsz'] },
  carousel: { label: '轮播', platforms: ['xhs', 'douyin', 'channels', 'mp', 'x', 'instagram', 'discord'], images: [1, 18] },
  article: { label: '长文', platforms: ['xhs', 'douyin', 'bilibili', 'mp', 'x', 'youtube', 'zsz', 'discord'] },
};

// 章节文案已经写进 platforms。这里只盖上类型：轮播挂同一份图片，不支持的渠道跳过。
export function applyKind(platforms, kind, images) {
  const spec = KINDS[kind];
  if (!spec || !spec.platforms) return;
  const list = Array.isArray(images) ? images : [];
  for (const [id, p] of Object.entries(platforms || {})) {
    if (!p || p.skip) continue;
    if (id === 'discord' && kind === 'video') {
      p.skip = '成片超过 Discord 附件上限（普通服务器约 10MB），这一期不发';
      continue;
    }
    if (!spec.platforms.includes(id)) {
      // 视频以前不限制渠道。没写进平台表的私有扩展仍保持原样，不在这里跳过。
      if (kind === 'video' && !PLATFORMS[id]) continue;
      p.skip = `这一期是${spec.label}，这个渠道还不能发`;
      continue;
    }
    if (id === 'discord' && kind === 'carousel' && list.length > 10) {
      p.skip = `轮播 ${list.length} 张，Discord 一条消息最多 10 张`;
      continue;
    }
    if (id === 'discord' && kind === 'article' && len(p.text || '') > 2000) {
      p.skip = `正文 ${len(p.text || '')} 字，Discord 一条消息最多 2000 字`;
      continue;
    }
    if (kind === 'carousel') {
      p.mode = 'images';
      p.images = list.slice();
      p.covers = [];
      delete p.video;
      continue;
    }
    if (kind === 'article') {
      p.mode = 'article';
      delete p.video;
    }
  }
}

export const len = (s) => [...(s || '')].length;

// X 的计数：中日韩字符算 2，链接一律算 23
export function xWeight(text) {
  let n = 0;
  const rest = text.replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
  for (const ch of rest) n += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return n;
}

// 返回 { errors: [], warnings: [] }；files 是工程目录里存在的相对路径集合（由调用方提供）
export function validate(b, files = null) {
  const errors = [], warnings = [];
  const has = (p) => !files || files.has(p);
  if (b.version !== 1) errors.push(`不认识的 version：${b.version}`);
  const kind = b.kind || 'video';
  if (!['video', 'carousel', 'article'].includes(kind)) errors.push(`不认识的类型：${b.kind}（视频、轮播、长文）`);
  if (kind === 'video') {
    if (!b.video) errors.push('缺少 video');
    else if (!has(b.video)) errors.push(`找不到视频：${b.video}`);
  } else if (b.video && !has(b.video)) errors.push(`找不到视频：${b.video}`);
  if (kind === 'carousel') {
    const [min, max] = KINDS.carousel.images;
    const imgs = Array.isArray(b.images) ? b.images : [];
    if (imgs.length < min || imgs.length > max) errors.push(`轮播 ${imgs.length} 张，要 ${min}–${max} 张`);
    for (const img of imgs) if (!has(img)) errors.push(`找不到图片 ${img}`);
    if (!Object.entries(b.platforms || {}).some(([id, p]) => !p.skip && KINDS.carousel.platforms.includes(id))) errors.push('轮播没有可发的渠道');
  }
  if (kind === 'article' && !Object.entries(b.platforms || {}).some(([, p]) => !p.skip)) errors.push('长文没有可发的渠道');
  if (kind !== 'carousel' && Array.isArray(b.images) && b.images.length) errors.push('只有轮播可以带图片列表');
  for (const [k, p] of Object.entries(b.covers || {})) if (!has(p)) errors.push(`找不到封面 ${k}：${p}`);
  if (b.schedule) {
    const t = Date.parse(b.schedule), now = Date.now();
    if (isNaN(t)) errors.push(`定时发布时间看不懂：${b.schedule}（要写成 2026-11-05T18:00:00+08:00）`);
    else if (t < now + 2 * 3600e3) errors.push(`定时发布要晚于现在 2 小时以上：${b.schedule}`);
    else if (t > now + 14 * 86400e3) errors.push(`定时发布最多 14 天以内：${b.schedule}`);
  }

  for (const [id, p] of Object.entries(b.platforms || {})) {
    const spec = PLATFORMS[id];
    if (!spec) { warnings.push(`未知平台 ${id}，会跳过`); continue; }
    const tag = spec.name;
    if (id === 'discord' && !DISCORD_CHANNEL.test(p.channel || '')) errors.push(`${tag}：频道地址要写成 https://discord.com/channels/<服务器>/<频道>`);
    if (p.skip) { warnings.push(`${tag}：跳过（${p.skip}）`); continue; }
    if (id === 'discord' && (b.kind || 'video') === 'video') errors.push(`${tag}：这一期是视频，不能发`);
    if (id === 'discord' && p.mode === 'images' && (p.images || []).length > 10) errors.push(`${tag}：一条消息最多 10 张图`);
    for (const c of p.covers || []) if (!(b.covers || {})[c]) errors.push(`${tag}：封面 ${c} 没有在 covers 里定义`);
    if (p.video && !has(p.video)) errors.push(`${tag}：找不到这个平台单独指定的视频 ${p.video}`);
    const fields = p.mode === 'images' && spec.images && spec.images.fields ? spec.images.fields
      : p.mode === 'article' && spec.article && spec.article.fields ? spec.article.fields
      : spec.fields;
    for (const [f, range] of Object.entries(fields)) {
      const [min, max] = range;
      const n = len(p[f]);
      if (n < min) errors.push(`${tag}：${f} ${n ? `只有 ${n} 字，至少 ${min} 字` : '为空'}`);
      if (n > max) errors.push(`${tag}：${f} ${n} 字，超过上限 ${max}`);
    }
    const all = Object.keys(fields).map(f => p[f] || '').join('\n') + (p.topics || []).join(' ');
    if (!spec.links) {
      if (/https?:\/\/|www\.|\.(com|cn|club|net)\b/i.test(all)) errors.push(`${tag}：正文里有链接，这个平台不能放`);
      if (/(微信|vx|v信|wx)\s*[:：号]?\s*[A-Za-z][-_A-Za-z0-9]{5,}|加微/i.test(all)) errors.push(`${tag}：正文里有微信号，这个平台不能放`);
      else if (/微信/.test(all)) warnings.push(`${tag}：正文提到了「微信」，确认不是在引流`);
      const lead = all.match(LEAD);
      if (lead) errors.push(`${tag}：正文在引流（「${lead[0]}」），这个平台最多写「整理成文档了，私信我」`);
      // 国内短视频平台直接写模型名容易被限流/封禁：用 Agent、CC、AI 这类代称（2026-11-12）
      const model = all.match(/Claude|Codex|ChatGPT|GPT-?\d|Gemini|Anthropic|OpenAI|DeepSeek/i);
      if (model) errors.push(`${tag}：出现了模型/厂商名「${model[0]}」，这个平台要换成 Agent、CC、AI 这类代称`);
      // 「Grok Bot / GrokBot」是系列名，国内平台可以透出（2026-11-13）；单独的「Grok」模型名只提醒
      const grok = all.replace(/Grok\s?Bot/gi, '').match(/Grok/i);
      if (grok) warnings.push(`${tag}：出现了单独的「Grok」，确认指的是 Grok Bot 而不是模型`);
    }
    // publish.json 的 requiredTags：每个带标签/话题的平台都必须有（例如账号名）
    // 长文平台引流到知识站：要落到转化页，不要用首页
    const list = p.tags || p.topics;
    if (list) for (const t of b.requiredTags || []) if (!list.includes(t)) errors.push(`${tag}：缺少「${t}」标签`);
    if (spec.maxTopics && (p.topics || []).length > spec.maxTopics) errors.push(`${tag}：话题 ${(p.topics || []).length} 个，最多 ${spec.maxTopics} 个（多出来的不会变成话题）`);
    if (spec.noAngle && /[<>]/.test(all)) errors.push(`${tag}：标题或简介里不能有 < 或 >`);
    if (spec.tags) {
      const t = p.tags || [];
      if (spec.tags.max && t.length > spec.tags.max) errors.push(`${tag}：标签 ${t.length} 个，最多 ${spec.tags.max} 个`);
      if (spec.tags.each) t.filter(x => len(x) > spec.tags.each).forEach(x => errors.push(`${tag}：标签「${x}」超过 ${spec.tags.each} 字`));
      if (spec.tags.total && t.join(',').length > spec.tags.total) errors.push(`${tag}：标签总长超过 ${spec.tags.total}`);
    }
    if (spec.maxHashtags && (all.match(/#[^\s#]+/g) || []).length > spec.maxHashtags) errors.push(`${tag}：话题标签 ${(all.match(/#[^\s#]+/g) || []).length} 个，最多 ${spec.maxHashtags} 个`);
    if (spec.maxSec && p.mode !== 'images' && b.durationSec > spec.maxSec) errors.push(`${tag}：视频 ${Math.round(b.durationSec / 60)} 分钟，网页上传最长 ${spec.maxSec / 60} 分钟`);
    if (p.mode === 'images') {
      const [min, max] = KINDS.carousel.images;
      const imgs = Array.isArray(p.images) ? p.images : [];
      if (imgs.length < min || imgs.length > max) errors.push(`${tag}：图文 ${imgs.length} 张，要 ${min}–${max} 张`);
      for (const img of imgs) if (!has(img)) errors.push(`${tag}：找不到图片 ${img}`);
      if ((b.kind || 'video') !== 'carousel') errors.push(`${tag}：图文填写和这一期的类型对不上`);
    } else if (p.mode === 'article') {
      if ((b.kind || 'video') !== 'article') errors.push(`${tag}：长文填写和这一期的类型对不上`);
    } else if (id === 'xhs' && p.mode) errors.push(`${tag}：不认识的 mode「${p.mode}」`);
    if (id === 'instagram' && /https?:\/\//.test(all)) warnings.push('Instagram：配文里的链接点不了，可以改成「主页简介里的链接」');
    if (id === 'mp' && p.mode !== 'images') {
      if (!(p.covers || []).includes('235x1')) errors.push(`${tag}：需要 235x1 封面`);
      if (!/^https:\/\/\S+$/.test(p.sourceUrl || '')) errors.push(`${tag}：原文链接必须是 https 地址`);
      else if (!/[?&]utm_source=mp(?:&|$)/.test(p.sourceUrl) || !/[?&]utm_campaign=/.test(p.sourceUrl)) warnings.push(`${tag}：原文链接建议带 utm_source=mp 和 utm_campaign`);
    }
    if (id === 'x') {
      const w = xWeight(p.text || '');
      if (p.mode !== 'article' && w > 280) warnings.push(`X：正文按 X 规则计 ${w}，超过 280，需要 Premium 才能发`);
      if (p.mode === 'article+quote') {
        if (!/^https:\/\/x\.com\/compose\/articles\/edit\/\d+$/.test(p.article || '')) errors.push('X：长文模式需要 article（长文草稿编辑页地址）');
        if (!b.schedule) errors.push('X：长文模式需要定时（schedule），howieip-studio 在定时前 20 分钟开始准备');
        warnings.push('X：长文 + 视频帖引用长文，由 howieip-studio 在定时前调度（发布助手侧边栏不处理这一项）');
      }
    }
  }
  return { errors, warnings };
}
