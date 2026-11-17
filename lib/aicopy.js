// 「AI 写文案」：连接知识站账号（设备授权，只拿麦田专用通行证，不拿 AI Key），按素材生成七个平台文案，写进 publish.json。
// 免费 3 次 → 会员每月 100 次 → 用自己的 AI 余额。额度在知识站服务端计，插件不收集任何数据。
import { PLATFORMS } from './bundle.js';

export const SITE = 'https://www.mdldm.club';
const STORE_KEY = 'maitianAccount';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function account() { return (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || null; }
export async function disconnect() { await chrome.storage.local.remove(STORE_KEY); }

async function post(path, body, token) {
  let r;
  try { r = await fetch(SITE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); }
  catch { return { status: 599, body: { error: 'network' } }; }   // 断网等，当作暂时失败
  let j = {}; try { j = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, body: j };
}

// 打开知识站授权页，等用户点「授权并连接」；onCode(授权码) 用于界面展示
export async function connect({ onCode, shouldStop = () => false } = {}) {
  const req = await post('/api/ai-tools/device-auth', { action: 'request', scope: 'maitian', label: '麦田发布助手' });
  if (req.status !== 200 || !req.body.device_code) throw new Error('连不上知识站，稍后再试');
  const { device_code, user_code, verification_uri, expires_in, interval } = req.body;
  onCode && onCode(user_code);
  const url = new URL(verification_uri); url.searchParams.set('code', user_code.replace(/-/g, ''));
  await chrome.tabs.create({ url: url.href, active: true });
  const until = Date.now() + (expires_in || 600) * 1000;
  let wait = Math.max(5, interval || 5) * 1000;
  while (Date.now() < until) {
    await sleep(wait);
    if (shouldStop()) throw new Error('已取消');
    const t = await post('/api/ai-tools/device-auth', { action: 'token', device_code });
    if (t.status === 200 && t.body.token) {
      const acc = { token: t.body.token, name: t.body.account_name || '', at: Date.now() };
      await chrome.storage.local.set({ [STORE_KEY]: acc });
      return acc;
    }
    const e = t.body.error;
    if (e === 'authorization_pending' || t.status >= 500) continue;   // 服务端偶发超时也接着等
    if (e === 'slow_down') { wait += 5000; continue; }
    if (e === 'access_denied') throw new Error('你在知识站拒绝了这次连接');
    if (e === 'expired_token') break;
    throw new Error('连接没成功，重新点一次「连接知识站账号」');
  }
  throw new Error('授权超时了，重新点一次「连接知识站账号」');
}

export async function quota() {
  const acc = await account(); if (!acc) return null;
  const r = await fetch(SITE + '/api/maitian/ai-copy', { headers: { Authorization: `Bearer ${acc.token}` } });
  if (r.status === 401) { await disconnect(); return null; }
  return r.ok ? r.json() : null;
}

// 返回 { platforms, problems, ...额度 }；失败抛错，err.vipUrl 有值时界面给「开通会员」按钮
export async function generate({ brief, title, platforms }) {
  const acc = await account();
  if (!acc) throw new Error('先连接知识站账号');
  const r = await post('/api/maitian/ai-copy', { brief, title, platforms }, acc.token);
  if (r.status === 401) { await disconnect(); throw new Error('连接失效了，重新连接知识站账号'); }
  if (r.status !== 200) throw Object.assign(new Error(r.body.message || 'AI 这次没写成，稍后再试'), { vipUrl: r.status === 402 ? r.body.vip_url : null, quota: r.body });
  return r.body;
}

// ---------- 工程目录里的素材 ----------
const VIDEO = /\.(mp4|mov|m4v)$/i, IMAGE = /\.(png|jpe?g|webp)$/i;
async function entries(dir, prefix = '', depth = 0, out = []) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') { if (depth < 1) await entries(h, prefix + name + '/', depth + 1, out); }
    else out.push({ path: prefix + name, handle: h });
  }
  return out;
}

// 读字幕 / 口播稿当素材（去掉时间轴）
export async function readBrief(dir) {
  const files = await entries(dir);
  const pick = files.find(f => /口播|文稿|脚本|script/i.test(f.path) && /\.(txt|md)$/i.test(f.path)) || files.find(f => /\.srt$/i.test(f.path)) || files.find(f => /发布素材\.md$/.test(f.path));
  if (!pick) return '';
  let t = await (await pick.handle.getFile()).text();
  if (/\.srt$/i.test(pick.path)) t = t.split(/\r?\n/).filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join('');
  return t.slice(0, 8000);
}

// 识别成片和三种比例的封面（按图片实际宽高判断）
async function detectMedia(dir) {
  const files = await entries(dir);
  const videos = files.filter(f => VIDEO.test(f.path));
  const video = (videos.find(f => /成片/.test(f.path)) || videos[0] || {}).path || null;
  const covers = {};
  for (const f of files.filter(f => IMAGE.test(f.path))) {
    try {
      const bmp = await createImageBitmap(await f.handle.getFile()); const r = bmp.width / bmp.height; bmp.close();
      const k = Math.abs(r - 0.75) < 0.06 ? '3x4' : Math.abs(r - 4 / 3) < 0.08 ? '4x3' : Math.abs(r - 16 / 9) < 0.08 ? '16x9' : null;
      if (k && (!covers[k] || /cover|封面/i.test(f.path))) covers[k] = f.path;
    } catch { /* 读不了的图片跳过 */ }
  }
  return { video, covers };
}

const COVER_PICK = { bilibili: ['4x3'], xhs: ['3x4'], douyin: ['4x3', '3x4'], channels: ['4x3', '3x4'], youtube: ['16x9'], x: [], instagram: ['16x9', '4x3'] };

// 把 AI 生成的字段合进 publish.json（没有就新建）；保留原有封面、跳过、单独视频等设置
export async function writeProject(dir, existing, generated, { title } = {}) {
  let data = existing ? JSON.parse(JSON.stringify(existing)) : null;
  if (!data) {
    const { video, covers } = await detectMedia(dir);
    data = { version: 1, id: dir.name, name: title || dir.name, video, requiredTags: [], covers, platforms: {} };
  }
  const has = (k) => !!(data.covers || {})[k];
  for (const [id, fields] of Object.entries(generated)) {
    if (!PLATFORMS[id]) continue;
    const old = data.platforms[id] || {};
    const covers = old.covers || (COVER_PICK[id] || []).filter(has).slice(0, id === 'instagram' ? 1 : 2);
    data.platforms[id] = { ...old, covers, ...fields };
  }
  if (existing) {   // 覆盖前留一份
    const bak = await dir.getFileHandle('publish.json.bak', { create: true });
    const w = await bak.createWritable(); await w.write(JSON.stringify(existing, null, 2) + '\n'); await w.close();
  }
  const fh = await dir.getFileHandle('publish.json', { create: true });
  const w = await fh.createWritable(); await w.write(JSON.stringify(data, null, 2) + '\n'); await w.close();
  return data;
}
