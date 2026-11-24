import { evaluate, sleep, waitFor, setValue } from '../cdp.js';

// 图文课表单来自 Knowledge Kit 的内容管理页 /admin/catalog。登录后对不上就失败，不点「创建课时」或「发布」。
const FORM = `document.querySelector('select[name=contentType]')?.closest('form')`;
const ACCESS = { '免费': 'public', 'VIP': 'member', '会员': 'member', '登录': 'registered' };

function catalog(data) {
  const admin = data?.platforms?.zsz?.admin;
  if (!admin) throw new Error('知识站没有后台地址');
  return String(admin).replace(/\/$/, '') + '/catalog';
}

async function setField(T, form, name, value) {
  const expr = `${form}.querySelector('[name=${JSON.stringify(name)}]')`;
  const kind = await evaluate(T, `(()=>{const el=${expr}; if(!el) return ''; return el.tagName})()`);
  if (!kind) return false;
  if (kind === 'SELECT') {
    const ok = await evaluate(T, `(()=>{const el=${expr}; const hit=[...el.options].some(o=>o.value===${JSON.stringify(value)}); if(!hit) return false; el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
    return ok;
  }
  return (await setValue(T, expr, value)) != null;
}

export default {
  id: 'zsz',
  name: '知识站',
  urlFor: catalog,
  ready: `!!document.querySelector('select[name=contentType]')`,
  loggedOut: `/请登录后继续|管理员登录/.test(document.body.innerText||'')`,

  async fill(ctx) {
    if (ctx.p.mode !== 'article') throw new Error('知识站视频建课还没接到这个适配器');
    const T = ctx.tabId, p = ctx.p;
    const href = await evaluate(T, 'location.href');
    if (!/\/catalog/.test(href)) {
      await evaluate(T, `location.href = ${JSON.stringify(catalog({ platforms: { zsz: p } }))}`);
    }
    if (/\/login|signin/i.test(await evaluate(T, 'location.href'))) throw new Error('还没登录');
    if (!await waitFor(T, `!!(${FORM})`, 20000)) throw new Error('找不到图文课表单');
    const series = await evaluate(T, `(()=>{const sel=${FORM}.querySelector('select[name=seriesId]'); if(!sel) return 'no-select';
      const opt=[...sel.options].find(o=>o.textContent.trim()===${JSON.stringify(p.series)}); if(!opt) return 'no-option';
      sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'})()`);
    if (series !== 'ok') throw new Error(series === 'no-option' ? `系列里没有「${p.series}」` : '找不到系列选择');
    if (!await setField(T, FORM, 'title', p.title)) throw new Error('找不到课时名称');
    if (!await setField(T, FORM, 'summary', p.summary)) throw new Error('找不到课时简介');
    if (!await setField(T, FORM, 'contentType', 'article')) throw new Error('找不到内容类型');
    if (!await setField(T, FORM, 'articleBody', p.body)) throw new Error('找不到图文正文');
    const access = ACCESS[p.access] || '';
    if (access) {
      const box = `${FORM}.querySelector('select[name=accessLevel]')`;
      await evaluate(T, `(()=>{const el=${box}; if(!el) return 0; el.value=${JSON.stringify(access)}; el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
    } else if (p.access) ctx.note(`访问等级「${p.access}」没有对应选项，保持页面默认`);
    ctx.note('网址标识要自己填。已填好，没有点「创建课时」或「发布」');
    await sleep(300);
  },

  uploadDone() { return null; },
};
