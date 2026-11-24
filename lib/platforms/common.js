// 适配器共用的小工具
import { evaluate, insertText, sleep, click, setFiles, waitFor } from '../cdp.js';

// 富文本编辑器里输入「#话题」，从联想列表里点「完全同名」的那一项；没有同名就保留成普通文字并记一条提示。
// itemsExpr：返回联想项元素数组的表达式
export async function pickTopics(ctx, topics, itemsExpr, { realClick = false } = {}) {
  const picked = [], plain = [];
  for (const t of topics) {
    await insertText(ctx.tabId, '#' + t);
    // 联想列表会滞后刷新：一直等到出现同名项，最多 4 秒
    // realClick：抖音的联想项只认真实鼠标点击（2026-11-12 起 .click() 不再生成话题）
    let hit = 'none';
    const find = `${itemsExpr}.filter(e=>e.getClientRects().length).find(e=>e.innerText.split('\\n')[0].trim()==='#'+${JSON.stringify(t)})`;
    for (let i = 0; i < 8 && hit !== 'picked'; i++) {
      await sleep(500);
      hit = await evaluate(ctx.tabId, `(()=>{const it=${itemsExpr}.filter(e=>e.getClientRects().length);
        const h=it.find(e=>e.innerText.split('\\n')[0].trim()==='#'+${JSON.stringify(t)}); if(h){${realClick ? "return 'found'" : "h.click(); return 'picked'"}}
        return it.length ? 'nomatch' : 'none'})()`);
      if (hit === 'found') hit = (await click(ctx.tabId, find)) ? 'picked' : 'none';
    }
    if (hit === 'picked') picked.push(t);
    else { plain.push(t); await insertText(ctx.tabId, ' '); }
    await sleep(400);
  }
  if (plain.length) ctx.note(`没有同名话题，保留为普通文字：${plain.join('、')}`);
  return picked;
}

// 把轮播图片交给上传框，并回读张数。oneByOne：这个框传完一张会换掉，只能逐张传。
export async function uploadImages(ctx, { input, count, oneByOne = false }) {
  const images = ctx.images || [];
  if (!images.length) throw new Error('图文模式没有图片');
  const T = ctx.tabId;
  const total = () => evaluate(T, count);
  const put = async (files, want) => {
    if (!await waitFor(T, `!!(${input})`, 15000)) throw new Error(oneByOne ? `第 ${want} 张找不到上传框` : '找不到上传框');
    await setFiles(T, input, files);
    const seen = await waitFor(T, `(${count}) >= ${want}`, oneByOne ? 60000 : 120000);
    const got = await total();
    if (!seen || got < want) throw new Error(oneByOne ? `图文只传上 ${got} 张，第 ${want} 张没有出现` : `图文只传上 ${got} 张，应该是 ${images.length} 张`);
    return got;
  };
  if (!oneByOne) {
    const got = await put(images, images.length);
    ctx.log(`图文 ${got} 张，第一张做封面`);
    return got;
  }
  for (let i = 0; i < images.length; i++) {
    await put([images[i]], i + 1);
    ctx.log(`图片 ${i + 1}/${images.length}`);
  }
  const got = await total();
  if (got < images.length) throw new Error(`图文缩略图 ${got} 张，应该是 ${images.length} 张`);
  ctx.log(`图文 ${got} 张，第一张做封面`);
  return got;
}

// 读回标题，和期望不一致就报异常
export async function checkTitle(ctx, expr, expected, label = '标题') {
  const got = await evaluate(ctx.tabId, expr);
  if ((got || '').trim() !== expected.trim()) ctx.fail(`${label}异常：期望「${expected}」，页面上是「${got || '空'}」`);
  else ctx.log(`${label}：${expected}`);
}

// 定时发布时间（ISO，带时区）→ 北京时间的各个字段
export function bjTime(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return { y, m, d: day, hh, mm, ymd: `${y}-${p(m)}-${p(day)}`, hm: `${p(hh)}:${p(mm)}`, text: `${y}-${p(m)}-${p(day)} ${p(hh)}:${p(mm)}` };
}
