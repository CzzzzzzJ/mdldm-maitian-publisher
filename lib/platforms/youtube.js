import { evaluate, setFiles, sleep, waitFor, insertText, pressKey, typeLines, focusSelectAll, setValue, click, byText } from '../cdp.js';
import { checkTitle } from './common.js';

const BOX = (i) => `[...document.querySelectorAll('#textbox[contenteditable]')][${i}]`;
const TAG_INPUT = `document.querySelector('input[aria-label="标签"], input[aria-label="Tags"]')`;

// 定时发布在最后一步「公开范围」里；要先回答「是否面向儿童」才能往后走
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  await evaluate(T, `(()=>{const r=document.querySelector('tp-yt-paper-radio-button[name=VIDEO_MADE_FOR_KIDS_NOT_MFK]'); if(r && r.getAttribute('aria-checked')!=='true') r.click(); return 1})()`);
  ctx.note('已选「不，内容不是面向儿童的」（定时发布要先回答这一项），如果不对请改');
  await sleep(800);
  await evaluate(T, `document.querySelector('button[test-id=REVIEW]').click()`);
  if (!await waitFor(T, `!!document.querySelector('#second-container-expand-button')`, 10000)) { ctx.fail('没进到「公开范围」这一步'); return; }
  await sleep(800);
  if (!await evaluate(T, `!!document.querySelector('#datepicker-trigger')`)) await evaluate(T, `document.querySelector('#second-container-expand-button').click()`);
  if (!await waitFor(T, `!!document.querySelector('#datepicker-trigger')`, 5000)) { ctx.fail('「安排时间」没有展开'); return; }
  await sleep(600);
  const tz = await evaluate(T, `[...document.querySelectorAll('ytcp-visibility-scheduler *')].filter(e=>e.childElementCount===0&&/GMT|UTC/.test(e.textContent)).map(e=>e.textContent.trim())[0]||''`);
  if (tz && !/\+0?8:?00/.test(tz)) ctx.note(`YouTube 时区是「${tz}」，不是北京时间，请检查`);

  const zh = `${s.y}年${s.m}月${s.d}日`;
  const en = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][s.m - 1]} ${s.d}, ${s.y}`;
  const trigger = (await evaluate(T, `(document.querySelector('#datepicker-trigger')||{}).innerText||''`)).trim();
  const english = /[A-Za-z]/.test(trigger);
  const dateText = english ? en : zh;
  if (trigger.replace(/\s+/g, ' ') !== dateText) {
    await evaluate(T, `document.querySelector('#datepicker-trigger').click()`); await sleep(1000);
    const mode = await evaluate(T, `(()=>{
      const i=[...document.querySelectorAll('input')].find(el=>el.getClientRects().length&&(/年/.test(el.value)||/\\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\b/.test(el.value)));
      if(!i) return '';
      i.focus(); i.select();
      return /年/.test(i.value)?'zh':'en';
    })()`);
    if (mode) {
      await insertText(T, mode === 'zh' ? zh : en); await sleep(300);
      await pressKey(T, 'Enter'); await sleep(600);
    } else {
      const day = await evaluate(T, `(()=>{
        const cells=[...document.querySelectorAll('ytcp-date-picker [role=gridcell], tp-yt-paper-dialog [role=gridcell], ytcp-date-picker tp-yt-paper-button')].filter(e=>e.getClientRects().length&&e.innerText.trim()===${JSON.stringify(String(s.d))}&&e.getAttribute('aria-disabled')!=='true');
        const hit=cells.at(-1); if(!hit) return false; hit.click(); return true;
      })()`);
      if (!day) { ctx.fail('定时的日期框没找到，没有点发布'); return; }
    }
    await pressKey(T, 'Escape'); await sleep(400);
  }
  const timeText = english ? `${s.hh % 12 || 12}:${String(s.mm).padStart(2, '0')} ${s.hh >= 12 ? 'PM' : 'AM'}` : s.hm;
  const armed = await evaluate(T, `(()=>{
    const i=[...document.querySelectorAll('input')].find(el=>el.getClientRects().length&&(/\\d{1,2}:\\d{2}/.test(el.value||'')||/time|时间/i.test(el.getAttribute('aria-label')||'')));
    if(!i) return false; i.focus(); i.select(); return true;
  })()`);
  if (!armed) { ctx.fail('定时的时间框没找到，没有点发布'); return; }
  await insertText(T, timeText); await sleep(300);
  await pressKey(T, 'Enter'); await sleep(600);
  const got = await evaluate(T, `(()=>{
    const date=((document.querySelector('#datepicker-trigger')||{}).innerText||'').trim();
    const time=([...document.querySelectorAll('input')].find(el=>el.getClientRects().length&&/\\d{1,2}:\\d{2}/.test(el.value||''))||{}).value||'';
    return date+' '+time.trim();
  })()`);
  const dateOk = got.includes(dateText);
  const timeOk = english ? new RegExp(`${s.hh % 12 || 12}:${String(s.mm).padStart(2, '0')}\\s*(AM|PM)`, 'i').test(got) : got.includes(s.hm);
  if (dateOk && timeOk) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${dateText} ${timeText}」`);
}

const CREATE_BTN = `(()=>{const out=[]; const walk=(root)=>{for (const el of root.querySelectorAll('ytcp-button')) {const r=el.getBoundingClientRect(); const t=(el.getAttribute('aria-label')||el.innerText||'').trim(); if ((t==='Create'||t==='创建') && r.y<80 && r.width) out.push(el);} for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);}; walk(document); return out[0]||null})()`;
const POST_ITEM = `(()=>{const out=[]; const walk=(root)=>{for (const el of root.querySelectorAll('tp-yt-paper-item')) {const t=el.innerText.trim(); const r=el.getBoundingClientRect(); if ((t==='Create post'||t==='创建帖子') && r.height>20) out.push(el);} for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);}; walk(document); return out[0]||null})()`;
const POST_BOX = `(()=>{return [...document.querySelectorAll('#contenteditable-root')].find(e=>e.getBoundingClientRect().height>0)||null})()`;
const POST_OPEN = `(()=>{const labels=["What's on your mind?","Post an update to your fans","有什么新鲜事？","向粉丝发布最新动态"]; return [...document.querySelectorAll('[role=button], button')].find(e=>labels.includes(e.getAttribute('aria-label')) && e.getBoundingClientRect().height>10)||null})()`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 社区帖的定时在发帖框右下角菜单里，不是视频那套「公开范围」
async function schedulePost(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  if (s.mm % 15) { ctx.fail('帖子定时只能选 15 分钟一档，没有点发布'); return; }
  const menu = `(()=>{return [...document.querySelectorAll('ytd-backstage-post-dialog-renderer button')].find(e=>['Action menu','操作菜单'].includes(e.getAttribute('aria-label')) && e.getBoundingClientRect().height>10)||null})()`;
  if (!await click(T, menu)) { ctx.fail('帖子定时入口没找到，没有点发布'); return; }
  await sleep(400);
  const item = `(()=>{const labels=['Schedule post','定时发布','安排发布时间']; return [...document.querySelectorAll('ytd-menu-service-item-renderer')].find(e=>labels.includes((e.innerText||'').trim()) && e.getClientRects().length)||null})()`;
  if (!await click(T, item)) { ctx.fail('帖子定时入口没找到，没有点发布'); return; }
  if (!await waitFor(T, `!!document.querySelector('#date-picker')`, 5000)) { ctx.fail('帖子定时面板没打开，没有点发布'); return; }
  await sleep(300);
  const dateNow = ((await evaluate(T, `(document.querySelector('#date-picker')||{}).innerText||''`)) || '').replace(/\s+/g, ' ').trim();
  const english = /[A-Za-z]/.test(dateNow);
  const dateText = english ? `${MONTHS[s.m - 1]} ${s.d}, ${s.y}` : `${s.y}年${s.m}月${s.d}日`;
  const timeText = english ? `${s.hh % 12 || 12}:${String(s.mm).padStart(2, '0')} ${s.hh >= 12 ? 'PM' : 'AM'}` : s.hm;
  if (dateNow !== dateText) {
    await click(T, `document.querySelector('#date-picker')`); await sleep(400);
    const armed = await evaluate(T, `(()=>{const i=document.querySelector('ytd-calendar-date-picker input'); if(!i) return false; i.focus(); i.select(); return true})()`);
    if (!armed) { ctx.fail('帖子日期框没找到，没有点发布'); return; }
    await insertText(T, dateText); await sleep(200);
    await pressKey(T, 'Enter'); await sleep(400);
  }
  const timeNow = ((await evaluate(T, `(document.querySelector('#time-picker')||{}).innerText||''`)) || '').replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
  if (timeNow.toUpperCase() !== timeText.toUpperCase()) {
    if (!await click(T, `document.querySelector('#time-picker')`)) { ctx.fail('帖子时间框没找到，没有点发布'); return; }
    await sleep(400);
    const ok = await evaluate(T, `(()=>{
      const norm=s=>(s||'').replace(/\\u202f/g,' ').replace(/\\s+/g,' ').trim().toUpperCase();
      const hit=[...document.querySelectorAll('tp-yt-paper-item, [role=option]')].find(e=>norm(e.innerText)===${JSON.stringify(timeText.toUpperCase())});
      if(!hit) return false; hit.scrollIntoView({block:'center'}); hit.click(); return true;
    })()`);
    if (!ok) { ctx.fail(`帖子时间列表里没有「${timeText}」，没有点发布`); return; }
    await sleep(300);
  }
  const tz = ((await evaluate(T, `(document.querySelector('#timezone-picker')||{}).innerText||''`)) || '').trim();
  if (tz && !/\+0?8:?00/.test(tz)) ctx.note(`YouTube 时区是「${tz}」，不是北京时间，请检查`);
  const gotDate = ((await evaluate(T, `(document.querySelector('#date-picker')||{}).innerText||''`)) || '').replace(/\s+/g, ' ').trim();
  const gotTime = ((await evaluate(T, `(document.querySelector('#time-picker')||{}).innerText||''`)) || '').replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
  if (gotDate === dateText && gotTime.toUpperCase() === timeText.toUpperCase()) ctx.log(`定时发布：${gotDate} ${gotTime}`);
  else ctx.fail(`定时没设对：页面上是「${gotDate} ${gotTime}」，应该是「${dateText} ${timeText}」`);
}

async function fillArticle(ctx) {
  const T = ctx.tabId, p = ctx.p;
  await evaluate(T, `location.href = 'https://studio.youtube.com/'`);
  if (!await waitFor(T, `document.body && document.body.innerText.length > 40`, 20000)) throw new Error('YouTube Studio 没有打开');
  if (/accounts\.google\.com|signin/.test(await evaluate(T, 'location.href'))) throw new Error('还没登录');
  if (!await click(T, CREATE_BTN)) throw new Error('找不到「创建」');
  if (!await waitFor(T, `!!(${POST_ITEM})`, 8000)) throw new Error('找不到「创建帖子」');
  const href = await evaluate(T, `(()=>{const out=[]; const walk=(root)=>{for (const el of root.querySelectorAll('a')) {const r=el.getBoundingClientRect(); const t=(el.innerText||'').trim(); if ((t==='Create post'||t==='创建帖子') && r.height>20 && /\\/posts/.test(el.href||'')) out.push(el.href);} for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);}; walk(document); return out[0]||''})()`);
  if (!href) throw new Error('找不到「创建帖子」');
  // show_create_dialog 打开的是图片帖，文字写不进去。社区帖正文在 Posts 页的 #contenteditable-root
  await evaluate(T, `location.href=${JSON.stringify(href.split('?')[0])}`);
  if (!await waitFor(T, `!!(${POST_OPEN}) || !!(${POST_BOX})`, 40000)) throw new Error('帖子输入框没有打开');
  if (!await evaluate(T, `!!(${POST_BOX})`)) {
    if (!await click(T, POST_OPEN)) throw new Error('帖子输入框没有打开');
    if (!await waitFor(T, `!!(${POST_BOX})`, 8000)) throw new Error('帖子输入框没有打开');
  }
  const text = [p.title, p.desc].filter(Boolean).join('\n\n');
  await click(T, POST_BOX);
  await focusSelectAll(T, POST_BOX);
  await typeLines(T, text);
  await sleep(400);
  const got = await evaluate(T, `(${POST_BOX}).innerText || ''`);
  if (!(got || '').includes(p.title)) ctx.fail('帖子正文和素材不一致');
  else ctx.log(`帖子：${got.length} 字`);
  if (ctx.schedule) await schedulePost(ctx);
  ctx.note('已填好，没有点 Post');
}

export default {
  id: 'youtube',
  name: 'YouTube',
  url: 'https://www.youtube.com/upload',
  ready: `!!document.querySelector('input[type=file][name=Filedata]')`,

  async fill(ctx) {
    if (ctx.p.mode === 'article') return fillArticle(ctx);
    const { tabId: T, p } = ctx;
    await setFiles(T, `document.querySelector('input[type=file][name=Filedata]')`, [ctx.video]);
    ctx.log('视频开始上传（默认私享）');
    if (!await waitFor(T, `document.querySelectorAll('#textbox[contenteditable]').length>=2`, 30000)) throw new Error('上传后没有出现详细信息表单');
    await sleep(2000);

    await focusSelectAll(T, BOX(0));
    await insertText(T, p.title);
    await sleep(500);
    await checkTitle(ctx, `${BOX(0)}.innerText`, p.title);

    // 说明框在后台标签页里不认回车键：直接插入带换行符的整段文字，再回读核对行数
    await focusSelectAll(T, BOX(1));
    await insertText(T, p.desc);
    await sleep(500);
    const lines = await evaluate(T, `${BOX(1)}.innerText.split('\\n').length`);
    if (lines < p.desc.split('\n').length) ctx.fail(`说明的换行没保留（页面 ${lines} 行，应为 ${p.desc.split('\n').length} 行）`);
    else ctx.log(`说明：${p.desc.length} 字`);

    const thumb = ctx.cover('16x9');
    if (thumb) {
      await setFiles(T, `[...document.querySelectorAll('input[type=file]')].find(i=>/image/.test(i.accept))`, [thumb]);
      await sleep(3000);
      ctx.log('缩略图：16:9');
    }

    if (p.tags && p.tags.length) {
      await evaluate(T, `(()=>{const b=document.querySelector('#toggle-button'); if(b && !${TAG_INPUT}) b.click(); return 1})()`);
      if (!await waitFor(T, `!!${TAG_INPUT}`, 8000)) ctx.fail('找不到标签输入框，标签没有填');
      else {
        await setValue(T, TAG_INPUT, '');
        await evaluate(T, `${TAG_INPUT}.focus()`);
        for (const t of p.tags) { await insertText(T, t); await sleep(200); await pressKey(T, 'Enter'); await sleep(300); }
        ctx.log(`标签：${p.tags.join('、')}`);
      }
    }
    if (ctx.schedule) await schedule(ctx);
    else ctx.note('还需要你选「是否面向儿童」（必填）和公开范围');
  },

  // 上传对话框被关掉时（第 4 期 2026-11-13），对话框里的进度条没了，改看右下角的上传进度浮窗，否则会一直等 4 小时
  uploadDone(ctx) {
    if (ctx.p.mode === 'article') return null;
    return `(()=>{const p=document.querySelector('ytcp-video-upload-progress'); const t=(p&&p.offsetParent?p.innerText:'')||((document.querySelector('ytcp-multi-progress-monitor')||{}).innerText||''); return /上传完毕|Upload complete|处理|Processing|检查完毕|Checks complete/.test(t) && !/正在上传|Uploading/.test(t)})()`;
  },

  // 发布后回传链接：Studio 内容列表，同名的跳过草稿
  links: {
    url: 'https://studio.youtube.com/',
    ready: `document.readyState === 'complete' && /\\/channel\\//.test(location.href)`,
    async collect(T, p) {
      if (!await evaluate(T, `/\\/videos/.test(location.pathname)`)) {
        await evaluate(T, `(location.href = location.href.replace(/(\\/channel\\/[^/]+).*/, '$1/videos/upload'), 1)`);
      }
      if (!await waitFor(T, `document.querySelectorAll('ytcp-video-row').length > 0`, 30000)) return null;
      const rows = await evaluate(T, `[...document.querySelectorAll('ytcp-video-row')].map(r=>({
        title:((r.querySelector('#video-title')||{}).innerText||'').trim(),
        href:(r.querySelector('a[href*="/video/"]')||{}).href||'',
        vis:((r.querySelector('.tablecell-visibility')||{}).innerText||'').trim(),
        date:((r.querySelector('.tablecell-date')||{}).innerText||'').replace(/\\n/g,' ').trim()}))`);
      const r = rows.find(x => x.title === p.title && !/草稿/.test(x.vis) && x.href);
      if (!r) return null;
      const id = (r.href.match(/\/video\/([^/]+)/) || [])[1];
      const sched = /预定|已安排|Scheduled/.test(r.date + r.vis);
      return { status: sched ? '定时' : (/公开|Public/.test(r.vis) ? '已发布' : r.vis), url: `https://youtu.be/${id}`, time: r.date };
    },
  },
};
