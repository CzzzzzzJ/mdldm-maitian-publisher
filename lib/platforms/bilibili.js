import { evaluate, setFiles, insertText, pressKey, sleep, waitFor, setValue, byText, click, fire, focusEnd, typeLines } from '../cdp.js';
import { checkTitle } from './common.js';

const TITLE = `document.querySelector('input[placeholder="请输入稿件标题"]')`;
const TAG_INPUT = `document.querySelector('input[placeholder="按回车键Enter创建标签"]')`;
const TAGS = `[...document.querySelectorAll('.tag-pre-wrp .label-item-v2-content')].map(e=>e.innerText.trim())`;

// 主封面槽里出现了真图（不再是「添加主封面」的空位）
const COVER_SET = `(()=>{const e=document.querySelector('.cover-module-main .cover-empty'); return !e || !e.offsetParent})()`;
const IMG_INPUT = `[...document.querySelectorAll('input[type=file]')].find(i=>/image\\/png/.test(i.accept))`;
const COVER_OPEN = `!!document.querySelector('.cover-editor-head-close')`;
const closeCover = (T) => click(T, `document.querySelector('.cover-editor-head-close')`);

async function setCover(T, file) {
  if (!await evaluate(T, COVER_OPEN)) await click(T, `document.querySelector('.cover-module-main .cover-empty-pill, .cover-module-main .cover-empty, .cover-module-main .cover-slot')`);
  if (!await waitFor(T, `!!${IMG_INPUT}`, 15000)) throw new Error('封面弹窗没有打开');
  await sleep(1000);
  await evaluate(T, `(()=>{const c=document.querySelector('.operation .sync'); if(c && c.querySelector('input').value!=='true') c.querySelector('label.sync-checkbox').click(); return 1})()`);
  await sleep(500);
  await setFiles(T, IMG_INPUT, [file]);
  await sleep(4500);
  await click(T, byText('完成'));
  await sleep(800);
  // 勾了双比例同步时，完成先弹出「确认同步」，同步后再点一次完成才会关掉编辑器
  const sync = `(()=>{return [...document.querySelectorAll('.videoup-confirm-modal .bcc-button, .videoup-confirm-modal button')].find(e=>e.innerText.trim()==='确认同步' && e.getClientRects().length)||null})()`;
  if (await evaluate(T, `!!(${sync})`)) {
    await click(T, sync);
    await sleep(800);
    if (await evaluate(T, COVER_OPEN)) await click(T, byText('完成'));
  }
  await sleep(1500);
}

// 定时发布：打开开关 → 日历里点日期（跨月就翻页）→ 时间面板点小时、分钟
const TC = '.time-container';
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  await evaluate(T, `(()=>{const w=document.querySelector('${TC} .switch-container'); if(!w.classList.contains('switch-container-active')) w.click(); return 1})()`);
  if (!await waitFor(T, `!!document.querySelector('${TC} .date-picker-date')`, 5000)) { ctx.fail('定时发布的开关没打开'); return; }
  const tz = await evaluate(T, `(document.querySelector('${TC} .bcc-select-input-inner')||{}).value||''`);
  if (!/UTC\+08:00/.test(tz)) ctx.note(`B 站定时的时区是「${tz}」，不是北京时间，请检查`);

  await fire(T, `document.querySelector('${TC} .date-picker-date')`); await sleep(500);
  const want = `${s.y}年${s.m}月`;
  for (let i = 0; i < 3; i++) {
    const title = await evaluate(T, `(document.querySelector('${TC} .date-picker-nav-title')||{}).textContent||''`);
    if (title.trim() === want) break;
    await fire(T, `document.querySelector('${TC} .next-btn-day')`); await sleep(400);
  }
  await fire(T, `[...document.querySelectorAll('${TC} .date-wrp .date-item, ${TC} .date-wrp .date-item-selected')].find(e=>e.textContent.trim()==='${s.d}')`);
  await sleep(500);

  await fire(T, `document.querySelector('${TC} .date-picker-timer')`); await sleep(500);
  const col = (i, v) => `[...(document.querySelectorAll('${TC} .time-picker-panel-select-wrp')[${i}]||{children:[]}).children].find(e=>e.textContent.trim()==='${String(v).padStart(2, '0')}')`;
  await fire(T, col(0, s.hh)); await sleep(400);
  await fire(T, col(1, s.mm)); await sleep(400);
  await fire(T, `document.querySelector('${TC} .date-picker-timer')`); await sleep(400);   // 收起时间面板

  const got = await evaluate(T, `[...document.querySelectorAll('${TC} .date-show')].map(e=>e.textContent.trim()).join(' ')`);
  if (got === s.text) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

const COLUMN_URL = 'https://member.bilibili.com/york/read-editor';
const COLUMN_TITLE = `document.querySelector('textarea.title-input__inner')`;
const COLUMN_BODY = `document.querySelector('.tiptap.ProseMirror')`;

async function fillArticle(ctx) {
  const T = ctx.tabId, p = ctx.p;
  await evaluate(T, `location.href = ${JSON.stringify(COLUMN_URL)}`);
  if (!await waitFor(T, `!!(${COLUMN_TITLE}) && !!(${COLUMN_BODY})`, 20000)) throw new Error('专栏编辑器没有打开');
  if (/login|passport/.test(await evaluate(T, 'location.href'))) throw new Error('还没登录');
  await setValue(T, COLUMN_TITLE, p.title);
  await sleep(300);
  await checkTitle(ctx, `${COLUMN_TITLE}.value`, p.title);
  await focusEnd(T, COLUMN_BODY);
  await typeLines(T, p.desc);
  ctx.log(`正文：${p.desc.length} 字`);
  const sw = `(()=>{const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='定时发布'); return label?label.parentElement.querySelector('.vui_switch-core'):null})()`;
  if (ctx.schedule && await evaluate(T, `!!(${sw})`)) {
    if ((await evaluate(T, `(()=>{const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='定时发布'); return label.parentElement.querySelector('.vui_switch--switch').getAttribute('aria-checked')})()`)) !== 'true') await click(T, sw);
    await click(T, byText('选择日期')); await sleep(500);
    const day = `(()=>{return [...document.querySelectorAll('.date-cell')].find(e=>e.innerText.trim()==='${ctx.schedule.d}' && !/disabled/.test(e.className) && e.getClientRects().length)||null})()`;
    if (!await click(T, day)) ctx.fail(`专栏日历里点不了 ${ctx.schedule.d} 日，没有点提交`);
    else {
      await click(T, byText('选择时间')); await sleep(400);
      const hh = String(ctx.schedule.hh).padStart(2, '0'), mm = String(ctx.schedule.mm).padStart(2, '0');
      // 点小时、分钟只是选中；不点「确定」就点到外面，弹层会关掉并丢掉时间
      const picked = await evaluate(T, `(()=>{
        const cols=[...document.querySelectorAll('.time-column')];
        const pick=(col,t)=>{const item=col&&[...col.querySelectorAll('.time-item')].find(e=>e.textContent.trim()===t && !e.classList.contains('disabled')); if(!item) return false; item.click(); return true};
        if(!pick(cols[0], ${JSON.stringify(hh)}) || !pick(cols[1], ${JSON.stringify(mm)})) return false;
        const btn=document.querySelector('.time-popup .confirm-button'); if(!btn) return false; btn.click(); return true;
      })()`);
      await sleep(400);
      const dateText = await evaluate(T, `(document.querySelector('.date-input-text')||{}).textContent.trim()`);
      const timeText = await evaluate(T, `(document.querySelector('.time-input-text')||{}).textContent.trim()`);
      if (picked && dateText === ctx.schedule.ymd && timeText === `${hh}:${mm}`) ctx.log(`定时发布：${ctx.schedule.text}`);
      else ctx.fail(`专栏定时没设对：页面上是「${dateText} ${timeText}」`);
    }
  } else if (ctx.schedule) ctx.fail('专栏定时控件没找到，没有点提交');
  if (p.tags && p.tags.length && await evaluate(T, `!!${TAG_INPUT}`)) {
    for (const t of p.tags) {
      await evaluate(T, `${TAG_INPUT}.focus()`);
      await insertText(T, t); await sleep(400);
      await pressKey(T, 'Enter'); await sleep(500);
    }
    ctx.log(`标签：${(await evaluate(T, TAGS) || []).join('、')}`);
  }
  const cover = ctx.cover('4x3');
  if (cover && await evaluate(T, `!!${IMG_INPUT}`)) {
    await setFiles(T, IMG_INPUT, [cover]);
    await sleep(1500);
    ctx.log('头图：4:3');
  } else if (cover) ctx.note('头图框没找到，封面没有传');
  ctx.note('已填好，没有点提交');
}

export default {
  id: 'bilibili',
  name: 'B 站',
  url: 'https://member.bilibili.com/platform/upload/video/frame',
  ready: `!!document.querySelector('.bcc-upload-wrapper input[type=file]')`,

  async fill(ctx) {
    if (ctx.p.mode === 'article') return fillArticle(ctx);
    const { tabId: T, p } = ctx;
    if (await evaluate(T, `/未提交的视频/.test(document.body.innerText||'')`)) { await click(T, byText('不用了')); await sleep(500); }
    await setFiles(T, `document.querySelector('.bcc-upload-wrapper input[type=file]')`, [ctx.video]);
    ctx.log('视频开始上传');
    if (!await waitFor(T, `!!${TITLE}`, 30000)) throw new Error('上传后没有出现稿件表单');
    await sleep(1500);

    // 封面：B 站的封面编辑器要渲染画布，后台标签页里做不成，切到前台做，做完回读确认
    const cover = ctx.cover('4x3');
    if (cover) {
      await ctx.withFocus(async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await setCover(T, cover);
          if (await evaluate(T, COVER_SET)) { ctx.log('封面：4:3（16:9 同步）'); return; }
          if (await evaluate(T, COVER_OPEN)) await closeCover(T);
          await sleep(800);
        }
        ctx.fail('封面没设上，请手动上传 4:3 封面');
      });
    }

    await setValue(T, TITLE, p.title);
    await sleep(300);
    await checkTitle(ctx, `${TITLE}.value`, p.title);

    const desc = await evaluate(T, `(()=>{const ed=[...document.querySelectorAll('.ql-editor')].find(e=>(e.dataset.placeholder||'').startsWith('填写更全面'));
      const q=ed && ed.closest('.ql-container').__quill; if(!q) return null; q.setText(${JSON.stringify(p.desc)}); return ed.innerText.length})()`);
    if (desc == null) ctx.fail('简介编辑器没找到，简介没有填');
    else ctx.log(`简介：${p.desc.length} 字`);

    // 标签：先删掉自动生成的，再逐个输入；被拒收的（比如和活动标签冲突）直接跳过
    for (let i = 0; i < 12; i++) {
      const n = await evaluate(T, `(()=>{const c=document.querySelector('.tag-pre-wrp .label-item-v2-container svg.close'); if(!c) return 0; c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1})()`);
      if (!n) break; await sleep(300);
    }
    const skipped = [];
    let rejectWhy = '';
    for (const t of p.tags || []) {
      const before = (await evaluate(T, TAGS)).length;
      await evaluate(T, `${TAG_INPUT}.focus()`);
      await insertText(T, t); await sleep(500);
      await pressKey(T, 'Enter'); await sleep(900);
      const after = await evaluate(T, TAGS);
      if (after.length <= before) {
        skipped.push(t);
        rejectWhy = rejectWhy || await evaluate(T, `(([...document.querySelectorAll('body *')].find(e=>e.childElementCount===0 && /活动专用|不允许自定义/.test(e.textContent) && e.textContent.length<80 && e.getClientRects().length)||{}).textContent||'').trim()`);
        await setValue(T, TAG_INPUT, '');
      }
    }
    const got = await evaluate(T, TAGS);
    ctx.log(`标签：${got.join('、')}`);
    if (skipped.length) ctx.note(`B 站拒收、已跳过的标签：${skipped.join('、')}${rejectWhy ? `（${rejectWhy}）` : ''}`);
    // 分区：固定「人工智能」（2026-11-13 上游），publish.json 可用 p.category 覆盖
    const cat = p.category || '人工智能';
    const CUR = `(document.querySelector('.video-human-type .select-item-cont')?.innerText||'').trim()`;
    if (await evaluate(T, CUR) !== cat) {
      await evaluate(T, `document.querySelector('.video-human-type .select-controller')?.click()`); await sleep(800);
      await evaluate(T, `[...document.querySelectorAll('.video-human-type .item-cont-main')].find(e=>e.innerText.trim()===${JSON.stringify(cat)})?.click()`); await sleep(800);
    }
    const gotCat = await evaluate(T, CUR);
    if (gotCat === cat) ctx.log(`分区：${cat}`); else ctx.fail(`分区没选上：页面上是「${gotCat}」，应该是「${cat}」`);
    if (ctx.schedule) await schedule(ctx);
    if (await evaluate(T, COVER_OPEN)) { await closeCover(T); await sleep(400); }
    const decl = '内容无需标注';
    const DECL = `document.querySelector('.creation-statement-container .bcc-select-input-inner')`;
    if (!await evaluate(T, `!!${DECL}`)) ctx.note('找不到创作声明，请手动选');
    else if ((await evaluate(T, `${DECL}.value`)) === decl) ctx.log(`创作声明：${decl}`);
    else {
      await click(T, DECL); await sleep(400);
      const option = `(()=>{return [...document.querySelectorAll('.creation-statement-container .bcc-option')].find(e=>e.innerText.trim()===${JSON.stringify(decl)} && e.getClientRects().length)||null})()`;
      await click(T, option); await sleep(400);
      const gotDecl = await evaluate(T, `${DECL}.value`);
      if (gotDecl === decl) ctx.log(`创作声明：${decl}`);
      else ctx.fail(`创作声明没选上：页面上是「${gotDecl || '空'}」`);
    }
  },

  uploadDone(ctx) {
    if (ctx.p.mode === 'article') return null;
    return `document.body.innerText.includes('上传完成')`;
  },

  // 发布后回传链接：稿件管理页的接口能直接拿到 BV 号、状态和定时时间
  links: {
    url: 'https://member.bilibili.com/platform/upload-manager/article',
    ready: `location.hostname === 'member.bilibili.com' && document.readyState === 'complete'`,
    async collect(T, p) {
      const list = await evaluate(T, `fetch('/x/web/archives?status=is_pubing%2Cpubed%2Cnot_pubed&pn=1&ps=30&coop=1',{credentials:'include'})
        .then(r=>r.json()).then(d=>(d.data&&d.data.arc_audits||[]).map(a=>a.Archive))`);
      const a = (list || []).find(x => x.title === p.title);
      if (!a) return null;
      const sched = a.dtime && a.dtime * 1000 > Date.now();
      return { status: sched ? '定时' : (a.state === 0 ? '已发布' : a.state_desc), url: `https://www.bilibili.com/video/${a.bvid}`, time: (sched ? a.dtime : a.ptime) * 1000 };
    },
  },
};
