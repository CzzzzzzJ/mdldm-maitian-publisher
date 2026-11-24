import { evaluate, setFiles, insertText, sleep, waitFor, setValue, click, fire, focusEnd, focusSelectAll, typeLines, pressKey } from '../cdp.js';
import { checkTitle, uploadImages } from './common.js';

// 单篇图文。2026-11-20 egolite 打开编辑页时是「登录超时」，选择器按当前图文编辑器
// （textarea#title、ProseMirror、作者/摘要区、官方 __MP_Editor_JSAPI__）来写，页面上没有这些字段就失败。
// 不点「发表」「群发」「通知粉丝」。
const EDITOR_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&lang=zh_CN';
const LIST_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10';
const TITLE = `document.querySelector('textarea#title') || document.querySelector('#title')`;
const EDITOR = `document.querySelector('div.ProseMirror[contenteditable=true]')`;
const AUTHOR = `document.querySelector('#js_author_area input, #js_author_area textarea, #js_author_area [contenteditable=true], #author')`;
const DIGEST = `document.querySelector('#js_description_area textarea, #js_description_area input, textarea[placeholder*="摘要"]')`;
const SOURCE = `document.querySelector('#js_article_url_area input, input[name="source_url"], input[placeholder*="原文"]')`;
const COVER = `document.querySelector('#js_cover_area')`;
const LOGGED_OUT = `/登录超时|请重新登录|微信扫一扫，选择公众平台账号登录/.test(document.body.innerText||'')`;
const IMG = `[...document.querySelectorAll('input[type=file]')].filter(i=>/image|jpeg|png|jpg/.test(i.accept||'image')).at(-1)`;

const textIn = (text, root) => `(()=>{const root=${root}; if(!root) return null; const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n; const h=[];
  while((n=w.nextNode())) if(n.nodeValue.trim()===${JSON.stringify(text)}) h.push(n.parentElement);
  return h.filter(e=>e.getClientRects().length).at(-1)||null})()`;
const DLG = `([...document.querySelectorAll('.weui-desktop-dialog,[role=dialog]')].filter(d=>d.getClientRects().length).at(-1)||null)`;
const norm = (s) => String(s || '').replace(/\s+/g, '');
const bodyHtml = (text) => text.split('\n').map((line) => {
  const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc ? `<p>${esc}</p>` : '<p><br></p>';
}).join('');

async function dismissTips(T) {
  const tip = textIn('我知道了', 'document.body');
  if (await evaluate(T, `!!${tip}`)) { await click(T, tip); await sleep(400); }
}

async function fillControl(T, expr, value) {
  const kind = await evaluate(T, `(()=>{const el=${expr}; if(!el) return ''; if(el.tagName==='INPUT'||el.tagName==='TEXTAREA') return 'value'; return el.isContentEditable?'text':''})()`);
  if (!kind) return null;
  if (kind === 'value') return setValue(T, expr, value);
  await focusSelectAll(T, expr);
  await insertText(T, value);
  return evaluate(T, `(${expr}).innerText`);
}

async function setCover(ctx, file) {
  const T = ctx.tabId;
  await ctx.withFocus(async () => {
    const opener = textIn('选择封面', `${COVER} || document.body`);
    if (!await click(T, opener)) {
      if (!await click(T, COVER)) throw new Error('找不到封面入口');
    }
    await sleep(800);
    await click(T, textIn('本地上传', `${DLG} || document.body`));
    await sleep(400);
    if (!await waitFor(T, `!!(${IMG})`, 8000)) throw new Error('封面上传框没有出现');
    await setFiles(T, IMG, [file]);
    await sleep(2500);
    for (const label of ['下一步', '确认', '完成']) {
      const btn = textIn(label, `${DLG} || null`);
      if (await evaluate(T, `!!${btn}`)) { await click(T, btn); await sleep(900); }
    }
  });
  const ok = await evaluate(T, `(()=>{const a=${COVER}; if(!a) return false; return !!a.querySelector('img') || /url\\(/.test(getComputedStyle(a).backgroundImage + a.innerHTML)})()`);
  if (!ok) ctx.fail('封面没设上，请手动上传 2.35:1 封面');
  else ctx.log('封面：2.35:1');
}

// 稿子页上若已有「定时发表」开关就打开并回读。开关在「发表」弹层或按钮里时不点，避免把发表层打开。
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  const entry = `(()=>{const el=${textIn('定时发表', 'document.body')}; if(!el||el.closest('.weui-desktop-dialog,[role=dialog],button,a')) return null; return el})()`;
  if (await evaluate(T, `!!${entry}`)) { await fire(T, entry); await sleep(700); }
  const input = `document.querySelector('input[placeholder*="时间"], input[placeholder*="日期"]')`;
  if (!await waitFor(T, `!!${input}`, 2000)) {
    ctx.fail('稿子页上没有定时控件。定时要在你点「发表」时再设，这里没有去点「发表」');
    return;
  }
  await setValue(T, input, s.text);
  await pressKey(T, 'Enter');
  await sleep(500);
  const got = ((await evaluate(T, `${input}.value`)) || '').replace(/\s+/g, ' ').trim();
  if (got.includes(s.text)) ctx.log(`定时发表：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got || '空'}」，应该是「${s.text}」`);
}

async function fillBody(ctx) {
  const T = ctx.tabId, html = bodyHtml(ctx.p.body);
  const via = await evaluate(T, `new Promise((resolve) => {
    const api = window.__MP_Editor_JSAPI__;
    if (!api || !api.invoke) return resolve('noapi');
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    api.invoke({ apiName: 'mp_editor_set_content', apiParam: { content: ${JSON.stringify(html)} }, sucCb: () => finish('ok'), errCb: (e) => finish('err') });
    setTimeout(() => finish('timeout'), 8000);
  })`);
  if (via !== 'ok') {
    if (!await evaluate(T, `!!${EDITOR}`)) throw new Error('找不到正文编辑器');
    await focusEnd(T, EDITOR);
    await typeLines(T, ctx.p.body);
    ctx.note(via === 'noapi' ? '编辑器没有官方写入接口，正文改用键盘输入' : '官方写入接口没成功，正文改用键盘输入');
  }
  const got = await evaluate(T, `(${EDITOR} && ${EDITOR}.innerText) || ''`);
  if (norm(got).includes(norm(ctx.p.body).slice(0, 40))) ctx.log(`正文：${ctx.p.body.length} 字`);
  else ctx.fail('正文和稿子不一致，请看编辑器');
}

const IMAGE_INPUT = `[...document.querySelectorAll('input[type=file]')].find(i=>/image|jpeg|png|jpg/.test((i.accept||'image')))`;
const IMAGE_COUNT = `document.querySelectorAll('img[src^="blob:"], img[src*="mmbiz"]').length`;
const IMAGE_BODY = `document.querySelector('textarea[placeholder*="描述"], textarea[placeholder*="正文"], div.ProseMirror[contenteditable=true]')`;

async function fillImages(ctx) {
  const T = ctx.tabId, p = ctx.p;
  if (await evaluate(T, LOGGED_OUT)) throw new Error('服务号没有登录，先在egolite 扫码');
  await evaluate(T, `location.href='https://mp.weixin.qq.com/'`);
  if (!await waitFor(T, `document.body && document.body.innerText.length > 20`, 20000)) throw new Error('公众平台首页没有打开');
  if (await evaluate(T, LOGGED_OUT)) throw new Error('服务号没有登录，先在egolite 扫码');
  await dismissTips(T);
  if (!await click(T, textIn('新的创作', 'document.body'))) throw new Error('找不到「新的创作」');
  await sleep(800);
  if (!await click(T, textIn('图片/文字', 'document.body'))) throw new Error('找不到「图片/文字」');
  if (!await waitFor(T, `!!(${IMAGE_INPUT}) || !!document.querySelector('textarea#title, #title')`, 20000)) throw new Error('图片/文字编辑器没有打开');
  await uploadImages(ctx, { input: IMAGE_INPUT, count: IMAGE_COUNT, oneByOne: true });
  if (!await waitFor(T, `!!(${TITLE})`, 20000)) throw new Error('找不到标题');
  await setValue(T, TITLE, p.title);
  await checkTitle(ctx, `(()=>{const el=(${TITLE}); if(!el) return ''; return el.tagName==='INPUT'||el.tagName==='TEXTAREA' ? el.value : el.innerText})()`, p.title, '标题');
  if (!await evaluate(T, `!!(${IMAGE_BODY})`)) throw new Error('找不到正文');
  const kind = await evaluate(T, `(()=>{const el=${IMAGE_BODY}; return el.tagName==='TEXTAREA'||el.tagName==='INPUT' ? 'value' : 'text'})()`);
  if (kind === 'value') await setValue(T, IMAGE_BODY, p.body);
  else { await focusEnd(T, IMAGE_BODY); await typeLines(T, p.body); }
  const got = await evaluate(T, `(()=>{const el=${IMAGE_BODY}; return el.value != null && el.tagName!=='DIV' ? el.value : el.innerText})()`);
  if (norm(got).includes(norm(p.body).slice(0, 40))) ctx.log(`正文：${p.body.length} 字`);
  else ctx.fail('正文和稿子不一致，请看编辑器');
  if (ctx.schedule) await schedule(ctx);
  ctx.note('已停在发表前，没有点「发表」或「群发」');
}

export default {
  id: 'mp',
  name: '服务号',
  url: EDITOR_URL,
  ready: `!!(${TITLE}) && (!!${EDITOR} || !!document.querySelector('#ueditor_0'))`,
  loggedOut: LOGGED_OUT,
  loginHint: '请在egolite 扫码登录公众平台',

  async fill(ctx) {
    if (ctx.p.mode === 'images') return fillImages(ctx);
    const { tabId: T, p } = ctx;
    if (await evaluate(T, LOGGED_OUT)) throw new Error('服务号没有登录，先在egolite 扫码');
    await dismissTips(T);
    if (!await waitFor(T, `!!(${TITLE})`, 20000)) throw new Error('图文编辑器没有打开');

    await setValue(T, TITLE, p.title);
    await checkTitle(ctx, `(()=>{const el=(${TITLE}); if(!el) return ''; return el.tagName==='INPUT'||el.tagName==='TEXTAREA' ? el.value : el.innerText})()`, p.title, '标题');

    if (p.author) {
      if (!await evaluate(T, `!!(${AUTHOR})`)) ctx.fail('找不到作者栏');
      else {
        await fillControl(T, AUTHOR, p.author);
        const got = await evaluate(T, `(()=>{const el=${AUTHOR}; return el.value != null && el.tagName !== 'DIV' ? el.value : el.innerText})()`);
        if ((got || '').trim() !== p.author.trim()) ctx.fail(`作者异常：期望「${p.author}」，页面上是「${got || '空'}」`);
        else ctx.log(`作者：${p.author}`);
      }
    }

    if (!await evaluate(T, `!!(${DIGEST})`)) ctx.fail('找不到摘要栏');
    else {
      await fillControl(T, DIGEST, p.digest);
      const got = await evaluate(T, `(()=>{const el=${DIGEST}; return el.value != null && el.tagName !== 'DIV' ? el.value : el.innerText})()`);
      if ((got || '').trim() !== p.digest.trim()) ctx.fail(`摘要异常：期望「${p.digest}」，页面上是「${got || '空'}」`);
      else ctx.log(`摘要：${p.digest.length} 字`);
    }

    await fillBody(ctx);

    if (!await evaluate(T, `!!(${SOURCE})`)) await click(T, textIn('原文链接', 'document.body'));
    if (!await waitFor(T, `!!(${SOURCE})`, 3000)) ctx.fail('找不到原文链接');
    else {
      await fillControl(T, SOURCE, p.sourceUrl);
      const got = await evaluate(T, `(()=>{const el=${SOURCE}; return (el.value != null && el.tagName !== 'DIV' ? el.value : el.innerText) || ''})()`);
      if ((got || '').trim() !== p.sourceUrl.trim()) ctx.fail(`原文链接异常：页面上是「${got || '空'}」`);
      else ctx.log('原文链接已填');
    }

    const cover = ctx.cover('235x1');
    if (cover) await setCover(ctx, cover);
    else ctx.fail('没有 2.35:1 封面');

    if (ctx.schedule) await schedule(ctx);
    ctx.note('已停在发表前，没有点「发表」或「群发」');
  },

  links: {
    url: LIST_URL,
    ready: `!!document.body && document.body.innerText.length > 20`,
    async collect(T, p) {
      const title = p.title;
      let hit = null;
      for (let i = 0; i < 6 && !hit; i++) {
        hit = await evaluate(T, `(()=>{
          const text = document.body.innerText || '';
          if (/登录超时|请重新登录|微信扫一扫，选择公众平台账号登录/.test(text)) return { status: '未登录' };
          if (!text.includes(${JSON.stringify(title)})) return null;
          const nodes = [...document.querySelectorAll('a, [class*=title]')];
          const el = nodes.find(e => (e.innerText || '').trim().startsWith(${JSON.stringify(title)})) || [...document.querySelectorAll('*')].find(e => (e.innerText || '').trim() === ${JSON.stringify(title)});
          if (!el) return { status: '未找到' };
          let card = el;
          for (let k = 0; k < 8 && card.parentElement; k++) { card = card.parentElement; if (/阅读|已发表|定时|发表失败/.test(card.innerText) && card.innerText.length < 900) break; }
          const a = [...card.querySelectorAll('a')].find(a => /mp\\.weixin\\.qq\\.com\\/s\\//.test(a.href));
          return { text: card.innerText.slice(0, 600), url: a ? a.href : '' };
        })()`);
        if (!hit) await sleep(1500);
      }
      if (!hit || hit.status === '未找到') return { status: '未找到', url: '', note: '发表记录里没找到同标题的文章' };
      if (hit.status === '未登录') return { status: '未登录', url: '' };
      const text = hit.text || '';
      const when = (text.match(/(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})/) || text.match(/(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2})/) || [])[1] || '';
      const status = /发表失败|未通过/.test(text) ? '异常' : /定时/.test(text) ? '定时' : '已发布';
      return { status, url: hit.url || '', time: when, note: status === '已发布' && !hit.url ? '发表记录里有这篇，但没读到文章链接' : '' };
    },
  },
};
