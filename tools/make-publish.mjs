// 从发布素材 md 生成 publish.json，写进 NAS 工程目录，并校验。
// 用法：node tools/make-publish.mjs <发布素材.md> <工程目录> [--require 账号名标签] [--schedule "2026-11-05 18:00"]
//
// md 约定（发布 skill 的模板，见 howieip-studio 仓库 skills/howieip-studio-publish）：
//   头部：「> 序号：31」「> 定时发布：2026-11-05 18:00」
//   ## 三、B站       **标题：** / **简介：** / **标签：**（#标签 空格分隔）
//   头部还可写「> 类型：视频|轮播|长文」（不写就是视频）。轮播在平台章节前写 **图片：**，每行一张。
//   ## 四、小红书     **标题：** / **正文：**（正文最后一行是 #话题）。类型决定发视频、轮播还是长文
//   ## 五、抖音       **标题：** / **正文：**
//   ## 六、视频号     **短标题：** / **描述：**
//   ## 七、YouTube   **标题：** / **简介：** / **标签：**（逗号分隔）
//   ## 八、X         整节就是推文
//   ## 九、Instagram 整节就是配文（链接点不了，话题标签写在末尾）
//   ## 十、知识站     **系列：** / **免费 / VIP：** / **标题：** / **简介：** / **详细介绍：**
//   ## 十一、服务号   **标题：** / **作者：** / **摘要：** / **正文：** / **原文链接：**
//   ## 十二、Discord  整节就是一条消息（最多 2000 字）。频道地址在工作室 config.json 的 discord
// 工程目录里：成片.mp4、封面/cover-3x4.png、cover-4x3.png、cover-16x9.jpg、cover-235x1.jpg（有哪个用哪个；服务号封面由 16:9 裁出）
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, applyKind, noteDiscordImages } from '../lib/bundle.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const require_ = opt('--require') || process.env.PUBLISH_REQUIRE_TAG || '';   // 每个平台必带的标签（比如账号名），可不填
const scheduleArg = opt('--schedule');
const [mdPath, dir] = args;
if (!mdPath || !dir) { console.error('用法：node tools/make-publish.mjs <发布素材.md> <工程目录> [--require 标签] [--schedule "YYYY-MM-DD HH:mm"]'); process.exit(2); }

function discordChannel() {
  const fromEnv = String(process.env.DISCORD_CHANNEL || '').trim();
  if (fromEnv) return fromEnv;
  const guesses = [process.env.HOWIEIP_STUDIO_CONFIG, join(dirname(fileURLToPath(import.meta.url)), '../../howieip-studio/config.json')].filter(Boolean);
  for (const f of guesses) {
    if (!existsSync(f)) continue;
    try {
      const c = JSON.parse(readFileSync(f, 'utf8'));
      if (typeof c.discord === 'string') return c.discord.trim();
    } catch { /* 下一个候选 */ }
  }
  return '';
}

const md = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
const clean = (s) => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();

// 按「## 一、xxx」切节，节名去掉序号
const sections = {};
md.split(/\n(?=## )/).forEach(chunk => {
  const m = chunk.match(/^## (?:[一二三四五六七八九十〇]+、)?(.+)\n/);
  if (m) sections[m[1].trim()] = chunk.slice(m[0].length).replace(/\n---\s*$/, '').trim();
});
const sec = (name) => {
  const k = Object.keys(sections).find(x => x.startsWith(name));
  return k ? sections[k] : null;
};
// 取 **标签：** 后到下一个 **xx：** 之前的内容
function field(text, label) {
  const re = new RegExp(`\\*\\*${label}：\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*\\n]+：\\*\\*|$)`);
  const m = text.match(re);
  return m ? clean(m[1]) : null;
}
const hashTags = (line) => (line.match(/#[^\s#]+/g) || []).map(t => t.slice(1));
// 正文最后一行如果全是 #话题，拆出来
function splitTopics(body) {
  const lines = body.split('\n');
  const last = lines[lines.length - 1].trim();
  if (last && last.split(/\s+/).every(w => w.startsWith('#'))) return { body: clean(lines.slice(0, -1).join('\n')), topics: hashTags(last) };
  return { body, topics: [] };
}

const header = (k) => { const m = md.match(new RegExp(`^> ${k}：\\s*(.+?)\\s*$`, 'm')); return m ? m[1] : null; };
const title = (md.match(/^# (.+)$/m) || [])[1] || basename(dir);
const episode = +(header('序号') || 0) || undefined;

let schedule = scheduleArg || header('定时发布');
if (schedule && !/T/.test(schedule)) schedule = schedule.trim().replace(' ', 'T') + ':00+08:00';

// 工程目录里的文件
const files = [];
const walk = (d) => readdirSync(d).forEach(n => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(relative(dir, p)); });
walk(dir);
const video = files.includes('成片.mp4') ? '成片.mp4' : null;
const covers = {};
for (const [k, n] of [['3x4', 'cover-3x4.png'], ['4x3', 'cover-4x3.png'], ['16x9', 'cover-16x9.jpg'], ['235x1', 'cover-235x1.jpg']]) if (files.includes(`封面/${n}`)) covers[k] = `封面/${n}`;
const has = (k) => !!covers[k];
const pick = (...ks) => ks.filter(has);

const NAME_KIND = { '视频': 'video', '轮播': 'carousel', '长文': 'article' };
const imageLines = (text) => (field(text || '', '图片') || field(text || '', '图文') || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^…+$/.test(l));
const preamble = md.split(/\n(?=## )/)[0];
const sharedImages = imageLines(preamble);
let extraImages = sharedImages;
let carouselImages = sharedImages.slice();
const kindToken = header('类型');
let kind = kindToken ? (NAME_KIND[kindToken] || kindToken) : 'video';

const platforms = {};
let s;
if ((s = sec('B站'))) platforms.bilibili = { covers: pick('4x3'), title: field(s, '标题'), desc: field(s, '简介'), tags: hashTags(field(s, '标签') || '') };
if ((s = sec('小红书'))) {
  const b = splitTopics(field(s, '正文') || '');
  const listed = sharedImages.length ? sharedImages : imageLines(s);
  if (!kindToken && listed.length) kind = 'carousel';
  if (kind === 'carousel') carouselImages = listed;
  else if (listed.length) extraImages = listed;
  const text = { title: field(s, '标题'), body: b.body, topics: b.topics };
  platforms.xhs = kind === 'article' ? { mode: 'article', covers: [], ...text } : { covers: kind === 'carousel' ? [] : pick('3x4'), ...text };
}
if ((s = sec('抖音'))) { const b = splitTopics(field(s, '正文') || ''); platforms.douyin = { covers: pick('4x3', '3x4'), title: field(s, '标题'), body: b.body, topics: b.topics }; }
if ((s = sec('视频号'))) { const b = splitTopics(field(s, '描述') || ''); platforms.channels = { covers: pick('4x3', '3x4'), shortTitle: field(s, '短标题'), body: b.body, topics: b.topics }; }
if ((s = sec('YouTube'))) platforms.youtube = { covers: pick('16x9'), title: field(s, '标题'), desc: field(s, '简介'), tags: (field(s, '标签') || '').split(/[,，]/).map(x => x.trim()).filter(Boolean) };
if ((s = sec('X'))) {
  // 「**长文：** <长文草稿编辑页地址>」：这期 X 走「长文 + 视频帖引用长文」，由 howieip-studio 在定时前调度，其余内容是视频帖文案
  const m = s.match(/^\*\*长文：\*\*\s*(https:\/\/x\.com\/compose\/articles\/edit\/\d+)\s*$/m);
  platforms.x = m ? { covers: [], mode: 'article+quote', article: m[1], text: clean(s.replace(m[0], '').split('\n').filter(l => !/^>/.test(l)).join('\n')) } : { covers: [], text: clean(s) };
}

if ((s = sec('Instagram'))) platforms.instagram = { covers: pick('16x9', '4x3').slice(0, 1), ...(files.includes('成片-ig.mp4') ? { video: '成片-ig.mp4' } : {}), caption: clean(s.split('\n').filter(l => !/^>/.test(l)).join('\n')) };
if ((s = sec('知识站'))) platforms.zsz = { series: field(s, '系列') || '', access: field(s, '免费 / VIP') || '', title: field(s, '标题') || '', summary: field(s, '简介') || '', body: field(s, '详细介绍') || '' };
if ((s = sec('服务号'))) platforms.mp = { covers: pick('235x1'), title: field(s, '标题') || '', author: field(s, '作者') || '', digest: field(s, '摘要') || '', body: field(s, '正文') || '', sourceUrl: (field(s, '原文链接') || '').trim() };
if ((s = sec('Discord'))) platforms.discord = { covers: [], text: clean(s), channel: discordChannel() };

// 服务号文章封面 900×383：从 16:9 上下裁。轮播走图片/文字，不用这张封面。383 是奇数，yuv420 的 jpeg 会被收成 382，所以用 4:4:4
if (kind !== 'carousel' && sec('服务号') && covers['16x9']) {
  const rel = '封面/cover-235x1.jpg';
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, covers['16x9']), '-vf', 'scale=900:383:force_original_aspect_ratio=increase,crop=900:383', '-pix_fmt', 'yuvj444p', '-q:v', '3', join(dir, rel)], { timeout: 60000 });
    covers['235x1'] = rel;
    if (!files.includes(rel)) files.push(rel);
    if (platforms.mp && !(platforms.mp.covers || []).includes('235x1')) platforms.mp.covers = pick('235x1');
  } catch (e) {
    console.log(`⚠️  服务号封面没裁出来：${e.message.split('\n')[0]}`);
  }
}
const images = kind === 'carousel' ? carouselImages : extraImages;

// 成片时长（秒）：有 ffprobe 就读出来，给需要时长的平台用
let durationSec;
if (video) {
  try { durationSec = Math.round(+execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, video)]).toString().trim()); } catch { /* 没装 ffprobe */ }
}

const out = {
  version: 1,
  id: basename(dir),
  ...(episode ? { episode } : {}),
  name: title,
  source: mdPath.replace(/^.*?\/doc\//, ''),
  ...(files.includes('发布素材.md') ? { source_backup: '发布素材.md' } : {}),
  kind,
  video,
  ...(images.length ? { images } : {}),
  ...(durationSec ? { durationSec } : {}),
  ...(files.includes('字幕.srt') ? { subtitle: '字幕.srt' } : {}),
  requiredTags: require_ ? [require_] : [],
  ...(schedule ? { schedule } : {}),
  covers,
  platforms,
};
// 本机私有扩展（不提交）：可以往 out.platforms 里加自己的平台
const localExt = join(dirname(fileURLToPath(import.meta.url)), 'make-publish.local.mjs');
if (existsSync(localExt)) {
  const m = await import(localExt);
  if (m.extend) m.extend({ out, sec, field, header, md, covers, pick });
}
applyKind(out.platforms, kind, carouselImages);

// 重新生成时保留手动加的 skip（比如某平台已经发过）
const target = join(dir, 'publish.json');
if (existsSync(target)) {
  const old = JSON.parse(readFileSync(target, 'utf8'));
  for (const [k, p] of Object.entries(old.platforms || {})) if (p.skip && out.platforms[k]) out.platforms[k].skip = p.skip;
}
if (out.platforms.discord) noteDiscordImages(out.platforms.discord, (img) => { try { return statSync(join(dir, img)).size; } catch { return 0; } });
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');

const { errors, warnings } = validate(out, new Set(files));
// Instagram 网页上传单个文件最大 1GB（PolarisCreationConstants.MAX_FILE_SIZE）：成片太大要先转一版
if (out.platforms.instagram && out.platforms.instagram.mode !== 'images' && !out.platforms.instagram.video && video && statSync(join(dir, video)).size > 1e9) {
  warnings.push(`Instagram：成片 ${(statSync(join(dir, video)).size / 1e9).toFixed(2)}GB，超过网页上传 1GB 上限，先转一版放进工程目录（ffmpeg -i 成片.mp4 -r 30 -c:v h264_videotoolbox -b:v 5000k -c:a aac -b:a 128k -movflags +faststart 成片-ig.mp4），重新生成时会自动给 Instagram 用`);
}
console.log(`已写入 ${target}`);
console.log(`平台：${Object.keys(platforms).join('、')}；封面：${Object.keys(covers).join(' / ')}；定时：${schedule || '无'}`);
warnings.forEach(w => console.log(`⚠️  ${w}`));
errors.forEach(e => console.log(`❌ ${e}`));
console.log(errors.length ? `校验未通过：${errors.length} 个问题` : '✅ 校验通过');
process.exit(errors.length ? 1 : 0);
