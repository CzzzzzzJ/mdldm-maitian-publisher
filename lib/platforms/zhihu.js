// 知乎视频：只填写、不点发布。选择器按上传页常见结构编写，待真实账号首跑核对。
import { evaluate, setFiles, sleep, waitFor, setValue, typeLines, clickText, insertText } from '../cdp.js';

const VIDEO_INPUT = `[...document.querySelectorAll('input[type=file]')]
  .find(i => /video/i.test(i.accept)) || document.querySelector('input[type=file]')`;
const IMAGE_INPUT = `[...document.querySelectorAll('input[type=file]')].find(i => /image/i.test(i.accept))`;
const TITLE_CANDIDATES = ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'];
const CAPTION_CANDIDATES = [
  'textarea[placeholder*="简介"]',
  'textarea[placeholder*="描述"]',
  '[contenteditable=true][placeholder*="简介"]',
];
const TOPIC_CANDIDATES = ['input[placeholder*="话题"]', 'input[placeholder*="搜索话题"]'];

/** 从候选选择器里取出当前页面上第一个可见元素。 */
function firstExisting(candidates) {
  return `(()=>{for (const s of ${JSON.stringify(candidates)}) {
    const e = document.querySelector(s); if (e && e.getClientRects().length) return e;
  } return null})()`;
}

/** 把北京时间转成日期输入框用的本地时间串。 */
function localTime(schedule) {
  const p = (n) => String(n).padStart(2, '0');
  return `${schedule.y}-${p(schedule.m)}-${p(schedule.d)}T${p(schedule.hh)}:${p(schedule.mm)}`;
}

/** 按文字完全匹配依次点候选按钮，点中一个就停。 */
async function clickAny(tabId, labels) {
  for (const label of labels) if (await clickText(tabId, label)) return true;
  return false;
}

/** 填写标题并回读核对。 */
async function fillTitle(ctx) {
  const { tabId: T, p } = ctx;
  const sel = firstExisting(TITLE_CANDIDATES);
  if (!await waitFor(T, `!!${sel}`, 5000)) { ctx.fail('知乎页面没有找到标题框，请手动填写'); return; }
  await setValue(T, sel, p.title);
  await sleep(300);
  const got = await evaluate(T, `(()=>{const e=${sel}; return e ? (e.value || e.innerText || '') : ''})()`);
  if ((got || '').trim() === p.title.trim()) ctx.log(`标题：${p.title}`);
  else ctx.fail(`标题异常：期望「${p.title}」，页面上是「${got || '空'}」`);
}

/** 填写简介。 */
async function fillCaption(ctx) {
  const { tabId: T, p } = ctx;
  if (!p.body) return;
  const sel = firstExisting(CAPTION_CANDIDATES);
  if (!await waitFor(T, `!!${sel}`, 5000)) { ctx.fail('知乎页面没有找到简介框，请手动填写'); return; }
  await evaluate(T, `(()=>{const e=${sel}; if (!e) return false; e.focus();
    if (e.isContentEditable) e.innerHTML = ''; else e.value = ''; return true})()`);
  await typeLines(T, p.body);
  ctx.log(`简介：${p.body.length} 字`);
}

/** 在话题框里逐个绑定话题。没有话题框就提示手动加，不假装已经绑上。 */
async function fillTopics(ctx) {
  const { tabId: T, p } = ctx;
  if (!p.topics || !p.topics.length) return;
  const sel = firstExisting(TOPIC_CANDIDATES);
  if (!await waitFor(T, `!!${sel}`, 4000)) {
    ctx.note('没有找到话题框，话题没有绑定，请手动添加');
    return;
  }
  for (const topic of p.topics) {
    await evaluate(T, `(()=>{const e=${sel}; e.focus(); return true})()`);
    await setValue(T, sel, '');
    await insertText(T, topic);
    await sleep(800);
    if (!await clickText(T, topic)) ctx.fail(`话题「${topic}」没有点中联想项，请手动绑定`);
  }
  ctx.log(`话题：${p.topics.join('、')}`);
}

/** 设定时发布。识别不到控件就明确告警，避免误记为已定时。 */
async function setSchedule(ctx) {
  const { tabId: T, schedule: s } = ctx;
  if (!await clickAny(T, ['定时发布', '定时'])) { ctx.fail('找不到知乎「定时发布」，请手动设置'); return; }
  const expr = `(()=>{const sel='input[type="datetime-local"],input[placeholder*="时间"],input[placeholder*="日期"]';
    for (const e of document.querySelectorAll(sel)) if (e.getClientRects().length) return e; return null})()`;
  if (!await waitFor(T, `!!${expr}`, 5000)) { ctx.fail('知乎定时输入框未出现，请手动设置'); return; }
  const value = localTime(s);
  await setValue(T, expr, value);
  const got = await evaluate(T, `(()=>{const e=${expr}; return e ? (e.value || '') : ''})()`);
  if ((got || '').includes(value) || (got || '').includes(s.text)) ctx.log(`定时发布：${s.text}`);
  else ctx.fail(`知乎定时未能核对：页面显示「${got}」，请手动设置 ${s.text}`);
}

/** 上传完成后设置 16:9 封面，没有就退回 4:3。 */
async function setCover(ctx) {
  const T = ctx.tabId;
  const cover = ctx.cover('16x9') || ctx.cover('4x3');
  if (!cover) return;
  const opened = await clickAny(T, ['上传封面', '编辑封面', '选择封面', '封面']);
  if (!opened || !await waitFor(T, `!!${IMAGE_INPUT}`, 10000)) {
    ctx.fail('没有找到知乎封面上传入口，请手动设置');
    return;
  }
  await setFiles(T, IMAGE_INPUT, [cover]);
  await sleep(1500);
  if (!await clickAny(T, ['确定', '完成'])) ctx.fail('封面上传后没有找到确认按钮，请手动确认');
  else ctx.log('封面已填写，请在发布前检查');
}

/** 传视频并填写标题、简介、话题和定时。封面等上传完成后再补。 */
async function fill(ctx) {
  const { tabId: T } = ctx;
  await setFiles(T, VIDEO_INPUT, [ctx.video]);
  ctx.log('视频开始上传');
  const formReady = `!!document.querySelector('input,textarea,[contenteditable=true]')`;
  if (!await waitFor(T, formReady, 30000)) throw new Error('上传后没有出现视频表单');
  await sleep(1500);
  await fillTitle(ctx);
  await fillCaption(ctx);
  await fillTopics(ctx);
  if (ctx.schedule) await setSchedule(ctx);
  ctx.note('领域和原创声明请在发布前手动确认；封面在视频上传完成后补');
}

/** 视频传完后补封面。 */
async function afterUpload(ctx) {
  await setCover(ctx);
}

/** 按作品链接找卡片。父级里一旦还有别的 zvideo 链接就停，避免读到整页列表。 */
async function findWork(T, p) {
  if (!p.title) return null;
  return evaluate(T, `(()=>{const t=${JSON.stringify(p.title)};
    for (const a of document.querySelectorAll('a[href*="zvideo"]')) {
      let card = a;
      for (let e = a; e.parentElement; e = e.parentElement) {
        if (e.parentElement.querySelectorAll('a[href*="zvideo"]').length > 1) { card = e; break; }
        card = e;
      }
      if ((a.innerText || '').includes(t) || (card.innerText || '').includes(t)) {
        return { url: a.href, text: card.innerText || '' };
      }
    }
    return null})()`);
}

const UPLOAD_DONE = `!!document.querySelector('input,textarea,[contenteditable=true]')
  && !/上传中|正在上传|取消上传/.test(document.body.innerText)`;

/** 按标题找回作品链接，并区分审核、定时和已发布。 */
async function collectLink(T, p) {
  const item = await findWork(T, p);
  if (!item) return null;
  const id = (item.url.match(/zvideo\/(\d+)/) || [])[1];
  const status = /审核/.test(item.text) ? '审核中' : /定时/.test(item.text) ? '定时' : '已发布';
  return { status, url: id ? `https://www.zhihu.com/zvideo/${id}` : item.url };
}

export default {
  id: 'zhihu',
  name: '知乎',
  url: 'https://www.zhihu.com/zvideo/upload-video',
  ready: `!!document.querySelector('input[type=file]')`,
  fill,
  uploadDone: UPLOAD_DONE,
  afterUpload,
  links: {
    url: 'https://www.zhihu.com/creator/manage/creation/zvideo',
    ready: `document.readyState==='complete' && document.body.innerText.length>0`,
    collect: collectLink,
  },
};
