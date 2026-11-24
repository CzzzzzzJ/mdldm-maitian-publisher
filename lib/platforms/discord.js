// Discord 普通文字频道：一段消息，轮播再挂最多 10 张图。停在发送前。
// 单独的回车会把消息发出去，所以这里只 insertText，换行用 Shift+Enter。
import { evaluate, insertText, sleep, waitFor, focusEnd, click, send } from '../cdp.js';
import { uploadImages } from './common.js';
import { DISCORD_CHANNEL as CHANNEL } from '../bundle.js';
const APP = 'https://discord.com/app';

const BOX = `(()=>{const all=[...document.querySelectorAll('div[role="textbox"][data-slate-editor="true"]')];
  return all.find(e=>/Message|消息/.test((e.getAttribute('aria-label')||'')+(e.getAttribute('aria-placeholder')||'')))||null})()`;
const TITLE = `!![...document.querySelectorAll('input, textarea, [role=textbox]')].find(e=>{
  const s=(e.getAttribute('aria-label')||'')+(e.getAttribute('placeholder')||'')+(e.getAttribute('aria-placeholder')||'');
  return /标题|Title|帖子标题|Post title|Announcement subject/i.test(s) && e.getClientRects().length})`;
const FILE = `(()=>{const box=${BOX}; const form=box&&box.closest('form');
  return (form&&form.querySelector('input[type=file]')) || document.querySelector('div[role="textbox"][data-slate-editor="true"]')?.closest('form')?.querySelector('input[type=file]') || null})()`;
const COUNT = `document.querySelectorAll('[aria-label="Remove Attachment"], [aria-label="移除附件"], [aria-label="Remove attachment"], [aria-label="删除附件"]').length`;
const UPLOAD = `(()=>{const labels=['Upload a File','上传文件','Add attachment','添加附件'];
  return [...document.querySelectorAll('button[aria-label]')].find(b=>labels.includes(b.getAttribute('aria-label')) && b.getClientRects().length)||null})()`;

function channelOf(p) {
  return String(p && p.channel || '').trim();
}

async function shiftEnter(tabId) {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 };
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function writeMessage(tabId, text) {
  if (!await focusEnd(tabId, BOX)) throw new Error('找不到发言框');
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await insertText(tabId, lines[i]);
    if (i < lines.length - 1) await shiftEnter(tabId);
    await sleep(40);
  }
}

export default {
  id: 'discord',
  name: 'Discord',
  url: APP,
  ready: `!!document.querySelector('[data-list-id="guildsnav"], [aria-label="Servers"], [aria-label="服务器"]')`,
  loggedOut: `/欢迎回来|Welcome back|Log in|登录/.test(document.body.innerText||'') && !!document.querySelector('input[name=email], input[aria-label="Email"], input[aria-label="电子邮件"]')`,

  async fill(ctx) {
    if (ctx.p.mode !== 'images' && ctx.p.mode !== 'article') throw new Error('Discord 不发视频');
    const T = ctx.tabId;
    const channel = channelOf(ctx.p);
    if (!CHANNEL.test(channel)) throw new Error('Discord 频道地址要写成 https://discord.com/channels/<服务器>/<频道>');
    const here = String(await evaluate(T, 'location.href') || '');
    if (!here.startsWith(channel.replace(/\/$/, ''))) {
      await evaluate(T, `location.assign(${JSON.stringify(channel)})`);
    }
    if (/\/login/.test(String(await evaluate(T, 'location.href') || ''))) throw new Error('还没登录');
    if (!await waitFor(T, `!!(${BOX}) || (${TITLE})`, 20000)) throw new Error('找不到发言框');
    if (await evaluate(T, TITLE)) throw new Error('这个频道的输入框带标题，只支持普通文字频道');
    if (!await evaluate(T, `!!(${BOX})`)) throw new Error('找不到发言框');
    await writeMessage(T, ctx.p.text);
    await sleep(300);
    const got = String(await evaluate(T, `(${BOX}&&${BOX}.innerText)||''`) || '').replace(/\u00a0/g, ' ').trim();
    const want = String(ctx.p.text || '').trim();
    if (!got || !want.split('\n').every(line => !line.trim() || got.includes(line.trim()))) ctx.fail('发言框里的内容和稿子不一致');
    else ctx.log(`消息：${[...want].length} 字`);
    if (ctx.p.mode === 'images') {
      if (!await evaluate(T, `!!(${FILE})`)) {
        if (!await click(T, UPLOAD)) throw new Error('找不到上传附件的按钮');
        await sleep(500);
      }
      await uploadImages(ctx, { input: FILE, count: COUNT });
    }
    if (ctx.schedule) ctx.note('Discord 没有定时开关，到点后自己点发送');
    ctx.note('已填进发言框，没有点发送。不要关这个页面，关掉会丢');
  },

  uploadDone() { return null; },
};
