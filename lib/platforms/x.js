import { evaluate, setFiles, sleep, waitFor, focusEnd, typeLines, click, byText } from '../cdp.js';
import { uploadImages } from './common.js';
import { xEngine } from '../engine.js';

const BOX = `document.querySelector('[data-testid=tweetTextarea_0]')`;
const FILE = `document.querySelector('input[data-testid=fileInput]')`;
const IMAGE_COUNT = `document.querySelectorAll('[data-testid=tweetPhoto]').length`;

// 定时：发帖框的日历按钮 → 月、日、年、时（24 小时）、分五个下拉框 → Confirm
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  if (!await evaluate(T, `(()=>{const b=document.querySelector('[data-testid=scheduleOption]'); if(!b) return false; b.click(); return true})()`)) { ctx.fail('找不到定时按钮'); return; }
  if (!await waitFor(T, `document.querySelectorAll('[role=dialog] select').length>=5`, 15000)) { ctx.fail('定时弹窗没打开'); return; }
  await sleep(500);
  await evaluate(T, `(()=>{const v=['${s.m}','${s.d}','${s.y}','${s.hh}','${s.mm}']; const ss=[...document.querySelectorAll('[role=dialog] select')].slice(0,5);
    const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    ss.forEach((el,i)=>{set.call(el,v[i]); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));}); return 1})()`);
  // 回读下拉框，没设上就报异常（2026-11-12 出现过小时/分钟没生效、停在默认时间）
  const vals = await evaluate(T, `[...document.querySelectorAll('[role=dialog] select')].slice(0,5).map(s=>s.value).join(',')`);
  // 按数字比：页面上分钟是「0」，期望值可能写成「00」（2026-11-12 第 37 期因此误报）
  const want = [s.m, s.d, s.y, s.hh, s.mm].map(Number).join(',');
  if (vals.split(',').map(Number).join(',') !== want) { ctx.fail(`定时下拉框没设上：页面 ${vals}，应为 ${want}`); return; }
  await sleep(500);
  await evaluate(T, `document.querySelector('[data-testid=scheduledConfirmationPrimaryAction]').click()`);
  await sleep(1500);
  const got = await evaluate(T, `([...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&/Will send on/.test(e.textContent))||{}).textContent||''`);
  if (got) ctx.log(`定时发布：${got.trim()}`);
  else ctx.fail('定时没设上，请在发帖框里手动设置');
}

function articleParts(text) {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return { title: '', body: '' };
  const title = lines[i].trim();
  const rest = lines.slice(i + 1).join('\n').trim();
  return { title, body: rest || text.trim() };
}

function htmlParagraphs(text) {
  return text.split('\n').map(line => {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc ? `<p>${esc}</p>` : '<p><br></p>';
  }).join('');
}

const engine = (cmd, arg) => `(${xEngine.toString()})(${JSON.stringify(cmd)}, ${JSON.stringify(arg)})`;

async function fillArticle(ctx) {
  const T = ctx.tabId, p = ctx.p;
  const { title, body } = articleParts(p.text);
  if (!title) throw new Error('X 长文没有标题');
  await evaluate(T, `location.href = 'https://x.com/compose/articles'`);
  if (!await waitFor(T, `document.body && document.body.innerText.length > 20`, 20000)) throw new Error('X 长文页没有打开');
  if (/\/i\/flow\/login|signin/.test(await evaluate(T, 'location.href'))) throw new Error('还没登录');
  if (/doesn.t exist|不存在|Page not found/i.test(await evaluate(T, 'document.body.innerText'))) {
    const href = await evaluate(T, `(()=>{const a=[...document.querySelectorAll('a')].find(e=>/^(Articles|文章|长文)$/.test((e.innerText||'').trim())); return a?a.href:''})()`);
    if (!href) throw new Error('这个号没有 X 长文。需要 Premium 且蓝标生效，侧栏才会出现 Articles。地址没写错，编辑器不会打开');
    await evaluate(T, `location.href=${JSON.stringify(href)}`);
    if (!await waitFor(T, `document.body && document.body.innerText.length > 20`, 20000)) throw new Error('X 长文页没有打开');
  }
  const titleBox = `!!([...document.querySelectorAll('textarea')].find(t => t.placeholder === 'Add a title' || t.placeholder === '添加标题'))`;
  if (!await evaluate(T, titleBox)) {
    const labels = ['Write an Article', 'New Article', 'Create', '撰写', '写文章', '新建'];
    let opened = false;
    for (const label of labels) if (await click(T, byText(label))) { opened = true; break; }
    if (!opened) throw new Error('找不到新建长文');
    if (!await waitFor(T, titleBox, 20000)) throw new Error('长文编辑器没有打开');
  }
  const titled = await evaluate(T, engine('setTitle', title));
  if (!titled || !titled.ok) throw new Error((titled && titled.error) || '标题没有写上');
  const pasted = await evaluate(T, engine('pasteHTML', htmlParagraphs(body)));
  if (!pasted || !pasted.ok) throw new Error('正文没有写上');
  await evaluate(T, engine('cleanup', null));
  const got = await evaluate(T, engine('state', null));
  if (!got || got.title !== title) ctx.fail(`标题是「${got && got.title || ''}」，应该是「${title}」`);
  else ctx.log(`长文：${title}，正文 ${body.length} 字`);
  ctx.note('已填好，没有点 Publish');
}

export default {
  id: 'x',
  name: 'X',
  url: 'https://x.com/compose/post',
  ready: `!!document.querySelector('[data-testid=tweetTextarea_0]') && !!document.querySelector('input[data-testid=fileInput]')`,

  async fill(ctx) {
    if (ctx.p.mode === 'article') return fillArticle(ctx);
    const { tabId: T, p } = ctx;
    await focusEnd(T, BOX);
    await typeLines(T, p.text);
    ctx.log(`正文：${p.text.length} 字`);
    if (p.mode === 'images') {
      await uploadImages(ctx, { input: FILE, count: IMAGE_COUNT });
      if (ctx.schedule) await schedule(ctx);
      ctx.note('不要关掉发帖框，关掉会丢失');
      return;
    }
    await setFiles(T, FILE, [ctx.video]);
    ctx.log('视频开始上传');
    await sleep(3000);
    if (ctx.schedule) await schedule(ctx);
    ctx.note('不要关掉发帖框，关掉会丢失');
  },

  uploadDone(ctx) {
    if (ctx.p.mode === 'images' || ctx.p.mode === 'article') return null;
    return `!/Uploading \\(\\d+%\\)/.test(document.body.innerText)`;
  },

  // 发布后回传链接：先看主页有没有发出来，没有再看定时列表
  links: {
    url: 'https://x.com/home',
    ready: `!!document.querySelector('a[data-testid=AppTabBar_Profile_Link]')`,
    async collect(T, p) {
      const first = p.text.split('\n')[0].trim();
      const me = await evaluate(T, `document.querySelector('a[data-testid=AppTabBar_Profile_Link]').href`);
      await evaluate(T, `(location.href = ${JSON.stringify(me)}, 1)`);
      if (await waitFor(T, `document.querySelectorAll('article [data-testid=tweetText]').length > 0`, 20000)) {
        await sleep(1500);
        const hit = await evaluate(T, `(()=>{const a=[...document.querySelectorAll('article')].find(a=>((a.querySelector('[data-testid=tweetText]')||{}).innerText||'').trim().startsWith(${JSON.stringify(first)}));
          if(!a) return null; const t=a.querySelector('time'); return {url:t&&t.parentElement.href, time:t&&t.getAttribute('datetime')}})()`);
        if (hit && hit.url) return { status: '已发布', url: hit.url, time: hit.time };
      }
      await evaluate(T, `(location.href = 'https://x.com/compose/post/unsent/scheduled', 1)`);
      if (!await waitFor(T, `[...document.querySelectorAll('[role=dialog]')].some(d=>/Scheduled|定时/.test(d.innerText))`, 20000)) return null;
      await sleep(1500);
      const s = await evaluate(T, `(()=>{const d=[...document.querySelectorAll('[role=dialog]')].map(d=>d.innerText).find(t=>t.includes(${JSON.stringify(first)})); if(!d) return null; const m=d.match(/Will send on ([^\\n]+)/); return m?m[1]:''})()`);
      if (s === null) return null;
      return { status: '定时', url: '', time: s, note: '发出后再回填一次就能拿到链接' };
    },
  },
};
