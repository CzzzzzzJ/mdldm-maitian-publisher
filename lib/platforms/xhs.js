import { evaluate, setFiles, sleep, waitFor, setValue, focusEnd, typeLines, pressKey, hover, click, byText, fire, insertText } from '../cdp.js';
import { pickTopics, checkTitle, uploadImages } from './common.js';

const TITLE = `document.querySelector('input[placeholder="填写标题会有更多赞哦"]')`;
const EDITOR = `document.querySelector('.tiptap.ProseMirror')`;

// 定时发布：打开开关，在日期框里直接输入「2026-11-05 18:00」
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  const SW = `document.querySelector('.post-time-switch-container .d-switch-simulator')`;
  const IN = `document.querySelector('.post-time-wrapper .d-datepicker-input-filter input')`;
  if (!await evaluate(T, `!!${SW}`)) { ctx.fail('找不到定时发布开关'); return; }
  if (!await evaluate(T, `${SW}.classList.contains('checked')`)) await fire(T, SW);
  if (!await waitFor(T, `!!${IN}`, 5000)) { ctx.fail('定时发布的时间框没出现'); return; }
  await evaluate(T, `(()=>{const i=${IN}; i.focus(); i.select(); return 1})()`);
  await insertText(T, s.text); await sleep(400);
  await pressKey(T, 'Enter'); await sleep(500);
  await evaluate(T, `${IN}.blur()`); await sleep(500);
  const got = await evaluate(T, `${IN}.value`);
  if (got === s.text) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

// 标题、正文、话题、定时。视频和图文是同一个表单，不点发布
async function fillNote(ctx) {
  const { tabId: T, p } = ctx;
  if (!await waitFor(T, `!!${TITLE}`, 30000)) throw new Error('没有出现笔记表单');
  await sleep(1500);
  await click(T, byText('我知道了'));   // 「PK 封面」引导弹窗，有就关掉

  await setValue(T, TITLE, p.title);
  await sleep(300);
  await checkTitle(ctx, `${TITLE}.value`, p.title);

  await focusEnd(T, EDITOR);
  await typeLines(T, p.body);
  if (p.topics && p.topics.length) {
    await pressKey(T, 'Enter'); await pressKey(T, 'Enter');
    const picked = await pickTopics(ctx, p.topics, `[...document.querySelectorAll('.item')]`);
    ctx.log(`话题：${picked.join('、') || '无'}`);
  }
  const len = await evaluate(T, `${EDITOR}.innerText.length`);
  ctx.log(`正文：${p.body.length} 字（编辑器 ${len}）`);
  if (ctx.schedule) await schedule(ctx);
}

const ARTICLE_TITLE = `document.querySelector('.edit-page textarea.d-text, textarea[placeholder="输入标题"]')`;
const ARTICLE_EDITOR = `document.querySelector('.rich-editor-content .tiptap.ProseMirror, .edit-page .tiptap.ProseMirror')`;
const IMAGE_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image';
const IMAGE_INPUT = `(()=>{const u=document.querySelector('.upload-input'); if(u) return u; return [...document.querySelectorAll('input[type=file]')].find(i=>/image|\\.jpe?g|\\.png|\\.webp/i.test(i.accept||'')) || document.querySelector('input[type=file]')})()`;
const IMAGE_COUNT = `document.querySelectorAll('.img-preview-area .pr').length`;

async function fillImages(ctx) {
  const T = ctx.tabId;
  const href = await evaluate(T, 'location.href');
  if (!href.includes('target=image') || href.includes('/login')) await evaluate(T, `location.href=${JSON.stringify(IMAGE_URL)}`);
  // 图文地址会先闪一下再跳登录页，要等登录页或上传框，不能只看地址里有没有 target=image
  if (!await waitFor(T, `location.href.includes('/login') || /短信登录|验证码登录|密码登录/.test(document.body.innerText) || !!(${IMAGE_INPUT})`, 30000)) throw new Error('图文页没有打开');
  const now = await evaluate(T, 'location.href');
  const text = await evaluate(T, 'document.body.innerText');
  if (now.includes('/login') || /短信登录|验证码登录|密码登录/.test(text)) throw new Error('还没登录');
  await uploadImages(ctx, { input: IMAGE_INPUT, count: IMAGE_COUNT, oneByOne: true });
  await fillNote(ctx);
}

async function pageText(T) {
  return evaluate(T, 'document.body.innerText');
}

async function assertLoggedIn(T) {
  const href = await evaluate(T, 'location.href');
  const text = await pageText(T);
  if (href.includes('/login') || /短信登录|验证码登录|密码登录/.test(text)) throw new Error('还没登录');
}

// 写长文：从发布页点「写长文」→「新的创作」，填标题正文。排版走到「下一步」就停，不点发布
async function fillArticle(ctx) {
  const T = ctx.tabId;
  const p = ctx.p;
  await assertLoggedIn(T);
  if (!await evaluate(T, `!!(${ARTICLE_TITLE})`)) {
    if (!await click(T, byText('写长文'))) throw new Error('找不到「写长文」');
    await sleep(800);
    await click(T, byText('新的创作'));
    if (!await waitFor(T, `!!(${ARTICLE_TITLE}) || location.href.includes('/login')`, 20000)) throw new Error('长文编辑器没有打开');
    await assertLoggedIn(T);
    if (!await evaluate(T, `!!(${ARTICLE_TITLE})`)) throw new Error('长文编辑器没有打开');
  }
  await setValue(T, ARTICLE_TITLE, p.title);
  await sleep(300);
  await checkTitle(ctx, `${ARTICLE_TITLE}.value`, p.title);
  if (!await evaluate(T, `!!(${ARTICLE_EDITOR})`)) throw new Error('找不到长文正文');
  await focusEnd(T, ARTICLE_EDITOR);
  await typeLines(T, p.body);
  if (p.topics && p.topics.length) {
    await pressKey(T, 'Enter'); await pressKey(T, 'Enter');
    const picked = await pickTopics(ctx, p.topics, `[...document.querySelectorAll('.item')]`);
    ctx.log(`话题：${picked.join('、') || '无'}`);
  }
  const len = await evaluate(T, `${ARTICLE_EDITOR}.innerText.length`);
  ctx.log(`长文：${p.body.length} 字（编辑器 ${len}）`);
  if (await click(T, byText('一键排版'))) {
    if (await waitFor(T, `!!(${byText('简约基础')})`, 8000)) await click(T, byText('简约基础'));
    await sleep(600);
    if (await waitFor(T, `!!(${byText('下一步')})`, 8000) && await click(T, byText('下一步'))) await sleep(1500);
    else ctx.note('排版后没找到「下一步」，停在长文编辑页');
  } else ctx.note('没找到「一键排版」，标题和正文已填，发布前需要在页面上排版');
  if (ctx.schedule && await evaluate(T, `!!document.querySelector('.post-time-switch-container .d-switch-simulator')`)) await schedule(ctx);
  ctx.log('长文已填写，没有点发布');
}

export default {
  id: 'xhs',
  name: '小红书',
  url: 'https://creator.xiaohongshu.com/publish/publish?source=official&target=video',
  ready: `!!document.querySelector('input[type=file]')`,
  loggedOut: `/短信登录|验证码登录|密码登录/.test(document.body.innerText)`,

  async fill(ctx) {
    if (ctx.p.mode === 'images') return fillImages(ctx);
    if (ctx.p.mode === 'article') return fillArticle(ctx);
    const { tabId: T } = ctx;
    await setFiles(T, `document.querySelector('input[type=file]')`, [ctx.video]);
    ctx.log('视频开始上传');
    await fillNote(ctx);
    ctx.note('封面要等视频上传完才能设置，传完会自动补上');
  },

  // 图文不走视频的「上传中 / 封面出现」等待；返回空，填完就是已填写
  uploadDone(ctx) {
    if (ctx.p.mode === 'images' || ctx.p.mode === 'article') return null;
    return `(()=>{const t=document.body.innerText; return !t.includes('上传中') && !t.includes('取消上传') && !!document.querySelector('.cover .default')})()`;
  },

  // 视频传完后：悬停封面 → 编辑封面 → 上传 3:4 → 裁剪比例改成 3:4 → 完成
  async afterUpload(ctx) {
    const T = ctx.tabId;
    const cover = ctx.cover('3x4');
    if (!cover) return;
    await hover(T, `document.querySelector('.cover .default')`);
    await sleep(600);
    if (!await click(T, `document.querySelector('.cover-edit-entry-text')`)) throw new Error('找不到「编辑封面」');
    const IMG = `[...document.querySelectorAll('input[type=file]')].find(i=>/image/.test(i.accept))`;
    if (!await waitFor(T, `!!${IMG}`, 20000)) throw new Error('封面编辑器没有打开');
    await sleep(1500);
    await setFiles(T, IMG, [cover]);
    await sleep(3500);
    await click(T, byText('裁剪')); await sleep(1000);
    await click(T, `(${byText('3:4')})?.parentElement`); await sleep(1200);
    if (!await click(T, byText('完成'))) throw new Error('封面编辑器里找不到「完成」');
    await sleep(2500);
    const ok = await evaluate(T, `document.body.innerText.includes('封面效果评估通过')`);
    ctx.log(`封面：3:4${ok ? '（平台评估通过）' : ''}`);
  },

  // 发布后回传链接：笔记管理页的卡片里埋着笔记 ID
  links: {
    url: 'https://creator.xiaohongshu.com/new/note-manager',
    ready: `document.querySelectorAll('.note-card').length > 0`,
    async collect(T, p, b) {
      // 先按标题找；标题在平台上改过就按定时时间找（只认唯一一条）。只读页面，不调接口
      const at = b && b.schedule ? new Date(Date.parse(b.schedule) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
      const c = await evaluate(T, `(()=>{const all=[...document.querySelectorAll('.note-card')];let c=all.find(c=>((c.querySelector('.note-card__title')||{}).innerText||'').trim()===${JSON.stringify(p.title)});
        if(!c&&${JSON.stringify(at)}){const hit=all.filter(c=>c.innerText.includes(${JSON.stringify(at)}));if(hit.length===1)c=hit[0]}
        if(!c) return null; let id=''; try{id=JSON.parse(c.getAttribute('data-impression')).noteTarget.value.noteId}catch(e){}
        return {id, text:c.innerText}})()`);
      if (!c || !c.id) return null;
      const time = (c.text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) || [''])[0];
      return { status: /定时发布/.test(c.text) ? '定时' : /审核/.test(c.text) ? '审核中' : '已发布', url: `https://www.xiaohongshu.com/explore/${c.id}`, time };
    },
  },
};
