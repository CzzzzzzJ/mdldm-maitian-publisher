// 只操作创作者中心渲染出来的表单，不请求后台接口，不触碰最终发布按钮。
import { evaluate, focusSelectAll, insertText, setFiles, setValue, waitFor } from '../cdp.js';
import { bilibiliCategory } from './common.js';

const visible = 'e=>e.getClientRects().length>0';
const unique = (selector, test = visible) => `(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(${test});return a.length===1?a[0]:null})()`;
const videoInput = unique('input[type=file]', `e=>!e.disabled&&!e.closest('[role=dialog],.ant-modal')&&(/video|mp4|mov/i.test(e.accept)||!e.accept)`);
const named = (selector, re) => unique(selector, `e=>(${visible})(e)&&${re}.test([e.placeholder,e.getAttribute('aria-label'),e.getAttribute('data-placeholder'),e.name].join(' '))`);
const titleInput = named('input:not([type=file]),textarea', /标题|title/i);
const descInput = named('textarea,[contenteditable=true]', /简介|描述|desc/i);
const acDescription = named('textarea', /请UP主为观众们介绍|简介/);
const captionEditor = `(${descInput}||${unique('[contenteditable=true]')})`;
const button = unique('button,[role=button]', `e=>(${visible})(e)&&/^(发布|立即发布|定时发布|提交投稿|提交)$/.test(e.innerText.trim())`);
const ksPublish = unique('[class*="_edit-section-btns_"] [class*="_button-primary_"]', `e=>(${visible})(e)&&e.innerText.trim()==='发布'&&!e.className.includes('disabled')`);
const pickNav = re => unique('a[href]', `e=>(${visible})(e)&&e.origin===location.origin&&e.href!==location.href&&${re}.test(e.innerText.trim())`);
const acUploadNav = pickNav(/^(视频投稿|投稿视频|上传视频|投稿)$/);
const byHost = (host, expr) => `(location.hostname===${JSON.stringify(host)}&&(${expr}))`;
const uploadError = '/(?:视频)?上传失败|文件格式不支持|上传出错/.test(document.body.innerText)';
const postReady = editor => `!!${editor}&&!/正在上传|上传中|上传失败/.test(document.body.innerText)&&/上传成功|上传完成/.test(document.body.innerText)`;
const ksAccepted = `!!${captionEditor}&&!!${ksPublish}&&/重新上传/.test(document.body.innerText)&&!/正在上传|上传中|上传失败|视频处理中/.test(document.body.innerText)&&(()=>{const video=document.querySelector('[class*="_preview-video_"] video');return !!video?.getClientRects().length&&video.readyState>=2&&video.videoWidth>0&&!!document.querySelector('[class*="_high-cover-editor_"]')})()`;

const normalized = s => String(s ?? '').replace(/\s+/g, ' ').trim();

async function write(ctx, expr, value, label) {
  if (!value) return;
  if (!await waitFor(ctx.tabId, `!!${expr}`, 5000)) throw new Error(`未唯一定位${label}`);
  if (await evaluate(ctx.tabId, `!!${expr}?.isContentEditable`)) {
    await focusSelectAll(ctx.tabId, expr);
    await insertText(ctx.tabId, value);
  } else {
    await setValue(ctx.tabId, expr, value);
  }
  const read = await evaluate(ctx.tabId, `(()=>{const e=${expr}; return e?.isContentEditable?e.innerText:e?.value})()`);
  if (normalized(read) !== normalized(value)) throw new Error(`${label}回读不一致`);
  ctx.log(`${label}回读通过`);
}

async function safeNavigate(tab, nav) {
  // 只跟随同域的明确导航链接，不点击表单按钮。
  return evaluate(tab, `(()=>{const a=${nav};if(!a)return false;location.assign(a.href);return true})()`).catch(() => false);
}

function publicUrl(raw, id) {
  try {
    const u = new URL(raw);
    const ok = id === 'acfun'
      ? u.hostname === 'www.acfun.cn' && /^\/v\/ac\d+\/?$/.test(u.pathname)
      : u.hostname === 'www.kuaishou.com' && /^\/short-video\/[\w-]+\/?$/.test(u.pathname);
    if (ok && u.protocol === 'https:' && !u.port && !u.username && !u.password) return u.origin + u.pathname.replace(/\/$/, '');
  } catch {}
  return '';
}

function workTime(value) {
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:?\d\d)$/.test(value)) return Date.parse(value);
  const m = value.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const [, y, month, day, hour, minute, sec = '00'] = m, two = x => x.padStart(2, '0');
  return Date.parse(`${y}-${two(month)}-${two(day)}T${two(hour)}:${minute}:${sec}+08:00`);
}

function matchWork(id, field, rows, p, cutoff, checkPublic) {
  const title = normalized(p.published_title || p[field]);
  if (!title) return null;
  const matches = rows.filter(r => normalized(r.title) === title);
  if (!matches.length) return null;
  if (matches.length !== 1) return { status: '待核对', url: '', note: '有多条同名作品，请手工确认' };
  const { status, urls = [], time, planned, earliest, workId } = matches[0];
  const seen = workTime(time), schedule = workTime(planned);
  const bound = Date.parse(cutoff);
  const evidence = Number.isFinite(seen) ? seen : Number.isFinite(earliest) ? earliest : schedule;
  if (!Number.isFinite(bound) || !(evidence >= bound)) return { status: '待核对', url: '', note: '同名作品没有可信的本期时间，请人工确认' };
  if (/^(审核中|待审核|转码中)$/.test(status)) return {status:'审核中',url:'',note:status};
  if (/^(审核未通过|审核失败|已退回)$/.test(status)) return {status:'已退回',url:'',note:status};
  if (schedule > Date.now() && (!status || status === '定时发布')) return {status:'定时发布',url:''};
  const needsPublicCheck = id === 'acfun' && !status && !!checkPublic;
  if (!needsPublicCheck && !/^(已发布|已上线|公开|已公开)$/.test(status)) return { status: '待核对', url: '', note: status || '未确认公开状态' };
  const derived = id === 'kuaishou' && typeof workId === 'string' && /^[a-z0-9]+$/i.test(workId) ? ['https://www.kuaishou.com/short-video/' + workId] : [];
  const links = [...new Set([...urls,...derived].map(u => publicUrl(u, id)).filter(Boolean))];
  if (links.length !== 1) return { status: '待核对', url: '', note: '未找到唯一的公开作品链接' };
  const accepted = { status: '已发布', url: links[0], ...(Number.isFinite(seen) ? { time: seen } : {}), ...(Number.isFinite(evidence) ? { matchedAt: evidence } : {}) };
  return needsPublicCheck ? checkPublic(links[0], title).then(ok => ok ? accepted : {status:'待核对',url:'',note:'公开作品页还未确认上线'}) : accepted;
}

async function checkAcfunPublic(url, name) {
  const tab = await chrome.tabs.create({url,active:false});
  try {
    const test = `location.origin==='https://www.acfun.cn'&&location.pathname===${JSON.stringify(new URL(url).pathname)}&&
      [...document.querySelectorAll('h1,[class*=video-title]')].some(e=>e.innerText?.replace(/\\s+/g,' ').trim()===${JSON.stringify(name)})&&
      !!document.querySelector('#player,video,[class*=player]')&&!/视频不存在|视频正在审核|仅自己可见|已下架/.test(document.body.innerText)`;
    return !!await waitFor(tab.id,test,11000,500);
  } finally { await chrome.tabs.remove(tab.id).catch(()=>{}); }
}

function workRows() {
  const visible = e => e.getClientRects().length;
  const status = /^(已发布|已上线|公开|已公开|审核通过|审核中|待审核|仅自己可见|定时发布|草稿|审核未通过|审核失败|已退回|转码中|已下架|私密)$/;
  const ac = location.hostname === 'member.acfun.cn';
  const selector = ac ? '.c-content-list .c-content-item' : '.works-manage .video-item';
  const rows = [...document.querySelectorAll(selector)].filter(visible);
  const mapped = rows.map(row => {
    const titleNode = [...row.querySelectorAll('[class*=title],[class*=caption],h3,h4,a[title]')].filter(visible).find(e => (e.innerText || e.title || '').trim());
    const title = (titleNode?.title || titleNode?.innerText || '').trim();
    const states = [...new Set((row.innerText || '').split('\n').map(s => s.trim()).filter(s => status.test(s) && s !== title))];
    const privacy = row.querySelector('.video-item__detail__row__photoStatus')?.innerText?.trim();
    const times = [...new Set([...row.querySelectorAll('time[datetime]')].filter(visible).map(e => e.dateTime))];
    const planned = row.querySelector('.publishTime')?.innerText?.match(/^定时发布时间\s*[：:]\s*(.+)$/)?.[1];
    if (!times.length) {
      const stamps = (row.innerText || '').split('\n').map(s => s.trim().replace(/^发布时间\s*[：:]\s*/, ''));
      times.push(...new Set(stamps.filter(s => /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?$/.test(s))));
    }
    const relative = ac && row.querySelector('.time')?.innerText?.trim().match(/^(\d+)\s*(分钟|小时|天)前$/);
    const earliest = relative ? Date.now() - (+relative[1] + 1) * ({分钟:60000,小时:3600000,天:86400000}[relative[2]]) : undefined;
    // 公开可见性不能覆盖审核、定时或私密状态。
    const blocking = /^(审核中|待审核|草稿|转码中|审核未通过|审核失败|已退回|已下架|私密|仅自己可见|定时发布)$/;
    const risky = [privacy, ...states].find(s => blocking.test(s))
      || (privacy && !/^(公开|已公开|所有人可见|已发布|已上线)$/.test(privacy) ? privacy : '');
    const lifecycle = states.find(s => /^(已发布|已上线)$/.test(s));
    const workId = !ac && row.__vue__?.$props?.videoInfo?.workId;
    return { row, title, workId, earliest, planned, status: risky || (!ac && lifecycle) || (states.length === 1 ? states[0] : ''), time: times.length === 1 ? times[0] : '', urls: [...row.querySelectorAll('a[href]')].map(a => a.href) };
  }).filter(r => r.title);
  // 一个卡片内可能套了同一作品的标记，取带状态的最内层，保留真正独立的同名卡。
  return mapped.filter(r => !mapped.some(s => s !== r && r.title === s.title && s.status && r.row.contains(s.row)))
    .map(({row,...data}) => data);
}

function linksFor(id, field, url, host, listSelector) {
  const match = (rows, p, cutoff) => matchWork(id, field, rows, p, cutoff);
  const confirm = (rows,p,cutoff,verify) => matchWork(id,field,rows,p,cutoff,verify);
  const read = byHost(host, `(${workRows.toString()})()`);
  return {
    url, match, confirm,
    ready: byHost(host, `location.pathname===${JSON.stringify(new URL(url).pathname)}&&!!document.querySelector(${JSON.stringify(listSelector)})`),
    async collect(tab, p, _data, cutoff) {
      const rows = await evaluate(tab, read);
      return confirm(Array.isArray(rows) ? rows : [], p, cutoff, id==='acfun' ? checkAcfunPublic : undefined);
    },
  };
}

async function prepare(ctx, host, nav) {
  const target = byHost(host, `!!${videoInput}`);
  if (nav && !await evaluate(ctx.tabId, target)) await safeNavigate(ctx.tabId, nav);
  if (!await waitFor(ctx.tabId, target, 12000)) throw new Error('未唯一定位视频上传框；请检查登录和页面布局');
  await setFiles(ctx.tabId, `(${byHost(host, videoInput)}||null)`, [ctx.video]);
  ctx.log('视频已交给上传页');
}

async function checks(ctx, cdpButton, fill) {
  try { await fill(); } catch (e) { ctx.requireReview(e.message); }
  if (ctx.schedule) ctx.requireReview(`请在平台手动核对定时：北京时间 ${ctx.schedule.text}`);
  const ready = await evaluate(ctx.tabId, `(()=>{const e=${cdpButton};return !!e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'})()`);
  if (!ready) ctx.requireReview('发布前请补齐平台必填项并确认发布按钮已可用');
}

const getImageSrc = expr => `(()=>{const e=${expr};return e?.complete&&e.naturalWidth>0?e.currentSrc:''})()`;
const clickInPage = (tab, expr) => evaluate(tab, `(()=>{const e=${expr};if(!e||e.disabled||!e.getClientRects().length)return false;e.click();return true})()`);
const coverChanged = (source, previous) => `(()=>{const v=${source};return !!v&&v!==${JSON.stringify(previous)}})()`;
const inDialog = (selector, hasHeader) => `e=>{const d=e.closest(${JSON.stringify(selector)});return !!d&&d.getClientRects().length&&(${hasHeader})}`;

const acCoverFile = unique('.video-cover-tool input[type=file]', `e=>!e.disabled&&/jpg|jpeg/i.test(e.accept)&&e.closest('.video-cover-tool')?.getClientRects().length`);
const acCoverModal = inDialog('.ivu-modal', "d.innerText.trim().startsWith('上传封面图片')&&[...d.querySelectorAll('.cropper-view-box img')].some(i=>i.complete&&i.naturalWidth>0)");
const acCoverConfirm = unique('.ivu-modal button', `e=>(${acCoverModal})(e)&&(${visible})(e)&&!e.disabled&&e.innerText.trim()==='确定'`);
const acCoverSource = getImageSrc(unique('.video-cover-tool img.videoCoverImage'));

async function acfunCover(ctx) {
  const file = ctx.cover?.(ctx.p.covers?.[0]);
  if (!file) return;
  const tab = ctx.tabId, prev = await evaluate(tab, acCoverSource);
  if (!await waitFor(tab, `!!${acCoverFile}`, 5000)) throw new Error('请手动上传 A 站封面（未定位封面上传框）');
  await setFiles(tab, acCoverFile, [file]);
  if (!await waitFor(tab, `!!${acCoverConfirm}`, 8000) || !await clickInPage(tab, acCoverConfirm)) throw new Error('请在 A 站封面裁剪框确认');
  if (!await waitFor(tab, coverChanged(acCoverSource, prev), 15000)) throw new Error('未读到 A 站已保存封面，请人工检查');
  ctx.log('封面上传并回读通过');
}

const acHost = 'member.acfun.cn';
const acPublish = unique('button', `e=>(${visible})(e)&&e.innerText.trim()==='发布内容'`);
const acTypeSelector = `(()=>{const groups=[...document.querySelectorAll('.ivu-radio-group')].map(g=>
  [...g.querySelectorAll('input[type=radio].ivu-radio-input')].filter(${visible}).map(e=>[e,e.closest('label')?.innerText.trim()])
).filter(choices=>choices.length===2&&choices.some(([,name])=>name==='原创')&&choices.some(([,name])=>name==='转载'));
return groups.length===1?groups[0]:null})()`;
const acTypeRead = byHost(acHost, `${acTypeSelector}?.find(([e])=>e.checked)?.[1] || ''`);
const acOriginalDefault = byHost(acHost, `(()=>{const options=${acTypeSelector};if(!options)return '';
  if(!options.some(([e])=>e.checked)){
    const original=options.find(([,name])=>name==='原创')[0];
    if(!original.disabled)original.click();
  }
  return options.find(([e])=>e.checked)?.[1]||'';
})()`);
const acChannel = '.video-channel-area.el-cascader input';
const acMenus = '.el-cascader-panel .el-cascader-menu';
const acPath = value => value.split(/\s*[\/／>→]\s*/).map(s => s.trim());
// 只添加有明确目标的 B 站分区；目标是 A 站投稿页中的完整路径。
const acFromBilibili = new Map([
  ['知识', '科技', '科技制造', ['人工智能', '科学科普']],
  ['知识', '科技', '人文科普', ['社科', '社科·法律·心理', '社科法律心理']],
  ['知识', '鱼塘', '普法安全', ['法律', '普法']],
  ['知识', '鱼塘', '历史', ['人文历史', '历史']],
  ['知识', '科技', '演讲·公开课', ['校园学习', '演讲·公开课', '演讲', '公开课']],
  ['科技', '科技', '科技制造', ['科技制造', '极客DIY']],
  ['科技', '科技', '数码家电', ['数码', '数码家电']],
  ['游戏', '游戏', '主机单机', ['单机游戏', '主机游戏', '主机单机']],
  ['游戏', '游戏', '手机游戏', ['手机游戏', '手游']],
  ['游戏', '游戏', '电子竞技', ['电子竞技', '电竞']],
  ['游戏', '游戏', '网络游戏', ['网络游戏', '网游']],
  ['游戏', '游戏', '桌游卡牌', ['桌游棋牌', '桌游卡牌']],
  ...['王者荣耀', '和平精英', '英雄联盟', '我的世界', '第五人格'].map(name => ['游戏', '游戏', name, [name]]),
].flatMap(([from, parent, leaf, names]) => names.flatMap(name => [
  [name, [parent, leaf]], [`${from}/${name}`, [parent, leaf]],
])));
function acfunCategory(p, bilibili) {
  if (typeof p.category === 'string' && p.category.trim()) {
    const path = acPath(p.category);
    return path.length === 2 && path.every(Boolean) ? path : null;
  }
  const source = bilibiliCategory(bilibili);
  if (typeof source !== 'string') return null;
  const target = acFromBilibili.get(acPath(source).join('/'));
  return target ? [...target] : null;
}

async function selectAcfunCategory(ctx) {
  const wanted = acfunCategory(ctx.p, ctx.projectPlatforms?.bilibili);
  if (!wanted) return ctx.requireReview('没有匹配的 A 站分区，请手动选择或填写「分区：一级 / 二级」');
  const tab = ctx.tabId, [parent, leaf] = wanted;
  const input = unique(acChannel);
  const current = `${input}?.value || ''`;
  const choices = [wanted.join('-'), wanted.join(' / ')];
  const correct = `${JSON.stringify(choices)}.includes((${current}).trim())`;
  if (!await evaluate(tab, correct)) {
    const hasMenu = `[...document.querySelectorAll(${JSON.stringify(acMenus)})].some(${visible})`;
    if (!await evaluate(tab, hasMenu) && !await clickInPage(tab, input)) throw new Error('未找到 A 站分区控件');
    const option = (i, name, branch) => `(()=>{const menu=[...document.querySelectorAll(${JSON.stringify(acMenus)})].filter(${visible})[${i}];
      const a=[...(menu?.querySelectorAll('.el-cascader-node')||[])].filter(e=>{
        const l=e.querySelector('.el-cascader-node__label');
        return (${visible})(e)&&!e.classList.contains('is-disabled')&&e.getAttribute('aria-disabled')!=='true'&&
          (e.getAttribute('aria-haspopup')==='true')===${branch}&&(l?.querySelector(':scope > span:not(.video-cascader-des)')||l)?.innerText.trim()===${JSON.stringify(name)};
      });return a.length===1?a[0]:null})()`;
    const group = option(0, parent, true), item = option(1, leaf, false);
    if (!await waitFor(tab, `!!${group}`, 3500)) throw new Error(`未找到 A 站一级分区「${parent}」`);
    await evaluate(tab, `(()=>{const e=${group};if(!e)return false;e.dispatchEvent(new MouseEvent('mouseenter'));return true})()`);
    if (!await waitFor(tab, `!!${item}`, 3500) || !await clickInPage(tab, item) || !await waitFor(tab, correct, 3500)) {
      throw new Error(`未确认 A 站分区「${parent} / ${leaf}」`);
    }
  }
  ctx.log(`分区：${parent} / ${leaf}`);
}

const acTagInput = unique('.tag-container input.video-input-box-val[placeholder="Enter回车可创建标签"]');
const acTagsRead = `[...document.querySelectorAll('.tag-container .video-content-tag-wrp .video-label-item-content')].filter(${visible}).map(e=>e.innerText.trim())`;
const acTagIO = tab => ({
  read: () => evaluate(tab, acTagsRead),
  async add(tag) {
    const recommended = unique('.tag-container .video-upload-tag-item', `e=>(${visible})(e)&&e.innerText.trim()===${JSON.stringify(tag)}`);
    if (!await clickInPage(tab, recommended)) {
      if (await setValue(tab, acTagInput, tag) !== tag) throw new Error('标签输入未回读');
      // 给标签框发不触发表单默认行为的 Enter，绝不对整页发送真实按键。
      await evaluate(tab, `(()=>{const e=${acTagInput};if(!e||e.value!==${JSON.stringify(tag)})return;
        for(const type of ['keydown','keypress','keyup']){
          if(e.value!==${JSON.stringify(tag)})break;
          const key=new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true});
          key.preventDefault();e.dispatchEvent(key);
        }
      })()`);
    }
    if (!await waitFor(tab, `(${acTagsRead}).includes(${JSON.stringify(tag)})`, 2300, 200)) {
      await setValue(tab, acTagInput, '').catch(()=>{});
    }
  },
});

async function fillAcfunTags(ctx, io = acTagIO(ctx.tabId)) {
  const tags = [...new Set((ctx.p.tags || []).map(t=>t.trim()).filter(Boolean))];
  if (!tags.length) return;
  let got = await io.read();
  for (const tag of tags) {
    if (got.includes(tag) || got.length >= 6) continue;
    await io.add(tag).catch(() => {});
    got = await io.read();
  }
  const missing = tags.filter(tag=>!got.includes(tag));
  const accepted = tags.filter(tag=>got.includes(tag));
  if (accepted.length) ctx.log(`标签回读：${accepted.join('、')}`);
  if (missing.length) ctx.requireReview(`A 站未确认这些标签，请核对：${missing.join('、')}`);
}

export const acfun = {
  name: 'A站',
  url: `https://${acHost}/upload-video`,
  ready: byHost(acHost, `!!(${videoInput}||${acUploadNav})`),
  uploadDone: byHost(acHost, postReady(titleInput)),
  uploadError: byHost(acHost, uploadError),
  category: acfunCategory,
  selectCategory: selectAcfunCategory,
  fillTags: fillAcfunTags,
  originalDefault: acOriginalDefault,
  fill: ctx => prepare(ctx, acHost, acUploadNav),
  async afterUpload(ctx) {
    await checks(ctx, `(${acPublish}||${button})`, async () => {
      await write(ctx, titleInput, ctx.p.title, '标题');
      await write(ctx, acDescription, ctx.p.desc, '简介');
      try {
        await evaluate(ctx.tabId, acOriginalDefault);
        const type = await waitFor(ctx.tabId, acTypeRead, 3000, 200);
        if (type) ctx.log(`稿件类型：${type}`);
        else ctx.requireReview('未确认 A 站稿件类型，请手动选择');
      } catch { ctx.requireReview('未确认 A 站稿件类型，请手动选择'); }
      await acfunCover(ctx);
      try { await selectAcfunCategory(ctx); } catch (e) { ctx.requireReview(`${e.message}，请手动选择`); }
      try { await fillAcfunTags(ctx); } catch { ctx.requireReview('A 站标签未能回读，请手动检查'); }
    });
  },
  links: linksFor('acfun', 'title', `https://${acHost}/video-history`, acHost, '.c-content-list'),
};

const ksHost = 'cp.kuaishou.com';
const ksUpload = `https://${ksHost}/article/publish/video`;
const ksCoverModal = '.ant-modal';
const ksCoverHeader = '[class*="_header-title-item_"]';
const ksCoverDialog = inDialog(ksCoverModal, `[...d.querySelectorAll(${JSON.stringify(ksCoverHeader)})].some(h=>h.innerText.trim()==='上传封面')`);
const ksUploadPane = inDialog(ksCoverModal, `d.querySelector('[class*="_header-title-item-active_"]')?.innerText.trim()==='上传封面'`);
const ksCropPreview = unique(`${ksCoverModal} canvas[class*="_cutter-raw_"]`, `e=>(${ksUploadPane})(e)&&(${visible})(e)&&e.width>0&&e.height>0`);
const coverEntry = unique('[class*="_high-cover-editor_"] [class*="_cover-full-editor_"]', `e=>(${visible})(e)&&e.innerText.trim()==='封面设置'`);
const coverTab = unique(`${ksCoverModal} ${ksCoverHeader}`, `e=>(${ksCoverDialog})(e)&&(${visible})(e)&&e.innerText.trim()==='上传封面'`);
const coverFile = unique(`${ksCoverModal} input[type=file][accept^="image/"]`, `e=>!e.disabled&&(${ksUploadPane})(e)`);
const clearStagedCover = unique(`${ksCoverModal} [class*="_cropper-upload-clear_"]`, `e=>(${ksUploadPane})(e)&&(${visible})(e)&&e.innerText.trim()==='清空上传'`);
const coverConfirm = unique(`${ksCoverModal} button`, `e=>(${ksUploadPane})(e)&&(${visible})(e)&&e.innerText.trim()==='确认'&&!e.disabled&&e.closest('.ant-modal').innerText.includes('清空上传')`);
const ksCoverSource = getImageSrc(unique('[class*="_default-cover_"] img'));

async function kuaishouCover(ctx) {
  const cover = ctx.cover(ctx.p.covers?.[0]);
  if (!cover) return;
  const previous = await evaluate(ctx.tabId, ksCoverSource);
  const open = await evaluate(ctx.tabId, `!!${coverTab}`);
  if ((!open && !await clickInPage(ctx.tabId, coverEntry)) || !await waitFor(ctx.tabId, `!!${coverTab}`, 5000) || !await clickInPage(ctx.tabId, coverTab)) throw new Error('请手动设置快手工程封面（未识别上传控件）');
  // 只清除裁剪弹窗里的临时图片；已应用的主封面在确认前不变。
  if (!await evaluate(ctx.tabId, `!!${coverFile}`) && await evaluate(ctx.tabId, `!!${clearStagedCover}`)) await clickInPage(ctx.tabId, clearStagedCover);
  if (!await waitFor(ctx.tabId, `!!${coverFile}`, 5000)) throw new Error('请手动设置快手工程封面（未识别文件框）');
  await setFiles(ctx.tabId, coverFile, [cover]);
  const confirmation = `(${ksCropPreview}&&${coverConfirm})`;
  if (!await waitFor(ctx.tabId, `!!${confirmation}`, 10000) || !await clickInPage(ctx.tabId, confirmation)) throw new Error('请手动确认快手工程封面（未读到预览）');
  if (!await waitFor(ctx.tabId, coverChanged(ksCoverSource, previous), 12000)) throw new Error('未读到快手已保存封面，请人工检查');
  ctx.log('封面上传并回读通过');
}

export const kuaishou = {
  name: '快手',
  url: ksUpload,
  ready: byHost(ksHost, `location.pathname==='/article/publish/video'&&!!${videoInput}`),
  uploadDone: byHost(ksHost, `(${postReady(captionEditor)})||(${ksAccepted})`),
  uploadError: byHost(ksHost, uploadError),
  fill: ctx => prepare(ctx, ksHost),
  async afterUpload(ctx) {
    await checks(ctx, `(${ksPublish}||${button})`, async () => {
      await write(ctx, captionEditor, ctx.p.caption, '作品描述');
      await kuaishouCover(ctx);
    });
  },
  links: linksFor('kuaishou', 'caption', `https://${ksHost}/article/manage/video`, ksHost, '.works-manage'),
};
