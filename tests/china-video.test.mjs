import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { validate } from '../lib/bundle.js';
globalThis.chrome = { debugger: { onDetach: { addListener() {} } } };
const { ADAPTERS, run } = await import('../lib/publish.js');

test('A站定时稿件缺状态文字时，必须核对对应作品公开页', async () => {
  const links = ADAPTERS.acfun.links;
  const p = {title:'测试'};
  const rows = [{title:'测试',status:'',planned:'2026-11-28 13:26',urls:['https://www.acfun.cn/v/ac123']}];
  const cutoff = '2026-11-27T14:00:00+08:00';
  assert.equal((await links.confirm(rows,p,cutoff,async()=>false)).url,'');
  const published = await links.confirm(rows,p,cutoff,async()=>true);
  assert.equal(published.url,rows[0].urls[0]);
  assert.equal(published.time,undefined);
  assert.equal((await links.confirm([{...rows[0],status:'审核中'}],p,cutoff,async()=>true)).status,'审核中');
});

test('快手按后台作品ID识别，无需列表外链，旧作和私密不回填', async () => {
  const {confirm} = ADAPTERS.kuaishou.links;
  const p = {caption:'完整文案'};
  const item = {title:p.caption,workId:'3x123',time:'2026-11-28 15:20',status:'已发布',urls:[]};
  const cutoff = '2026-11-28T13:00:00+08:00';
  const result = await confirm([item],p,cutoff);
  assert.equal(result.url,'https://www.kuaishou.com/short-video/3x123');
  assert.equal((await confirm([{...item,time:'2026-10-09 14:30'}],p,cutoff)).url,'');
  assert.equal((await confirm([{...item,status:'私密'}],p,cutoff)).url,'');
});

test('A站立即发布用后台相对时间作关联证据，不编造精确发布时间', async () => {
  const {confirm} = ADAPTERS.acfun.links;
  const row = {title:'测试',status:'',earliest:1795856400000,urls:['https://www.acfun.cn/v/ac123']};
  const cutoff = new Date(row.earliest - 60000).toISOString();
  const result = await confirm([row], {title:'测试'}, cutoff, async()=>true);
  assert.equal(result.url,row.urls[0]);
  assert.equal(result.time,undefined);
  assert.equal((await confirm([row], {title:'测试'}, new Date(row.earliest + 1).toISOString(), async()=>true)).url,'');
});

test('A 站稿件类型未选时默认原创，已有的转载不覆盖', () => {
  for (const initial of [null, '原创', '转载']) {
    let clicked = 0;
    const controls = ['原创','转载'].map(name => ({
      checked: initial === name, disabled: false, getClientRects: () => [1],
      closest: () => ({innerText:name}),
      click() { clicked++; this.checked = true; },
    }));
    const group = {querySelectorAll:()=>controls};
    const page = vm.createContext({location:new URL(ADAPTERS.acfun.url),document:{querySelectorAll:()=>[group]}});
    assert.equal(vm.runInContext(ADAPTERS.acfun.originalDefault, page), initial || '原创');
    assert.equal(clicked, initial ? 0 : 1);
  }
});

test('A 站标签填完回读：已有的不重复，拒收的单独提醒', async () => {
  const selected = ['已有'], values = [], reviews = [];
  let current = '';
  const io = {
    read: async () => [...selected],
    add: async tag => { current = tag; values.push(tag); if (tag !== '拒收') selected.push(tag); },
  };
  await ADAPTERS.acfun.fillTags({ p:{ tags:['已有','新增','新增','拒收'] }, log:()=>{}, requireReview:m=>reviews.push(m) }, io);
  assert.deepEqual(values,['新增','拒收']);
  assert.equal(current,'拒收');
  assert.deepEqual(selected,['已有','新增']);
  assert.equal(reviews.length,1);
  assert.match(reviews[0],/拒收/);
});

test('A 站超过页面六个标签上限时提前提示', () => {
  const result=validate({version:1,video:'v.mp4',platforms:{acfun:{title:'标题',tags:['1','2','3','4','5','6','7']}}});
  assert.ok(result.errors.some(x=>/最多 6 个/.test(x)));
});

test('A 站复用 B 站分区意图，A 站显式选择优先，未知分区不套默认', () => {
  const select = ADAPTERS.acfun.category;
  assert.deepEqual(select({}), ['科技', '科技制造']);
  assert.deepEqual(select({}, { category: '人工智能' }), ['科技', '科技制造']);
  assert.deepEqual(select({ category: '科技 / 人文科普' }, { category: '人工智能' }), ['科技', '人文科普']);
  assert.equal(select({}, { category: '旅游' }), null);
});

test('按确认的 A 站子分区映射社科和游戏，不猜游戏大类', () => {
  const select = ADAPTERS.acfun.category;
  for (const [from, to] of [
    ['社科·法律·心理', ['科技','人文科普']],
    ['知识 / 人文历史', ['鱼塘','历史']],
    ['游戏 / 单机游戏', ['游戏','主机单机']],
    ['电子竞技', ['游戏','电子竞技']],
    ['手机游戏', ['游戏','手机游戏']],
    ['王者荣耀', ['游戏','王者荣耀']],
    ['网络游戏', ['游戏','网络游戏']],
    ['桌游棋牌', ['游戏','桌游卡牌']],
  ]) assert.deepEqual(select({}, { category: from }), to, from);
  assert.equal(select({}, { category: '游戏' }), null);
  assert.equal(select({}, { category: '生活 / 单机游戏' }), null);
});

test('A 站和快手各自校验必要文案', () => {
  const result = validate({ version: 1, video: 'video.mp4', platforms: {
    acfun: { title: '   ' }, kuaishou: { caption: '' }
  } });
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /A站.*title/);
  assert.match(result.errors[1], /快手.*caption/);
});

test('A 站按投稿页实际字数限制校验标题和简介', () => {
  const result = validate({ version: 1, video: 'video.mp4', platforms: {
    acfun: { title: '字'.repeat(51), desc: '字'.repeat(1001) }
  } });
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /上限 50$/);
  assert.match(result.errors[1], /上限 1000$/);
});

test('只回填唯一的公开作品，不把同名、审核中或后台地址当作已发布', () => {
  for (const [id, field, url] of [
    ['acfun', 'title', 'https://www.acfun.cn/v/ac123'],
    ['kuaishou', 'caption', 'https://www.kuaishou.com/short-video/xyz123']
  ]) {
    const match = ADAPTERS[id].links.match;
    const row = { title: '本期作品', status: '已发布', urls: [url + '?foo=bar'] };
    const p = { [field]: '本期作品' };
    assert.equal(match([row], p)?.url, url);
    assert.ok(!match([row, row], p)?.url);
    assert.ok(!match([{ ...row, status: '审核中' }], p)?.url);
    assert.ok(!match([{ ...row, status: '审核通过' }], p)?.url);
    assert.ok(!match([{ ...row, urls: [ADAPTERS[id].links.url] }], p)?.url);
    assert.equal(match([{ ...row, title: '本期作品（重发）' }], p), null);
    const cutoff = '2026-11-27T13:00:00+08:00';
    assert.ok(!match([row], p, cutoff)?.url);
    assert.ok(!match([{ ...row, time: '2026-11-27 12:00' }], p, cutoff)?.url);
    assert.equal(match([{ ...row, time: '2026-11-27 14:00' }], p, cutoff)?.url, url);
  }
});

test('快手定时工程上传、回读文案后停在人工检查，从不按回车提交', async () => {
  let uploaded = false, focused, keys = 0, clicks = 0;
  const location = new URL(ADAPTERS.kuaishou.url);
  const input = { accept: 'video/mp4', closest: () => null };
  const caption = { isContentEditable: true, name: '', innerText: '', getClientRects: () => [1], getAttribute: () => '作品描述', focus() { focused = this; } };
  const publish = { innerText: '发布', getClientRects: () => [1], getAttribute: () => null };
  const document = { body: { get innerText() { return uploaded ? '上传完成' : '上传视频'; } }, querySelectorAll(s) {
    if (s === 'input[type=file]') return [input];
    if (s === 'textarea,[contenteditable=true]' || s === '[contenteditable=true]') return uploaded ? [caption] : [];
    if (s === 'button,[role=button]') return [publish];
    return [];
  } };
  const page = vm.createContext({ location, document, getSelection: () => ({ selectAllChildren() {} }) });
  globalThis.chrome.tabs = { create: async () => ({ id: 765 }), get: async () => ({ url: location.href }) };
  Object.assign(chrome.debugger, {
    attach: async () => {}, detach: async () => {},
    sendCommand: async (_tab, method, params) => {
      if (method === 'Runtime.evaluate') {
        const v = vm.runInContext(params.expression, page);
        return { result: v === input ? { objectId: 'video-file' } : { value: v } };
      }
      if (method === 'DOM.setFileInputFiles') {
        assert.equal(params.objectId, 'video-file');
        assert.deepEqual(params.files, ['/temp/episode/sample.mp4']);
        uploaded = true;
      }
      if (method === 'Input.insertText') focused.innerText += params.text;
      if (method === 'Input.dispatchKeyEvent') { keys++; if (params.type === 'char') focused.innerText += '\n'; }
      if (method === 'Input.dispatchMouseEvent') clicks++;
      return {};
    }
  });
  const states = await run({ dir: 'episode', data: {
    id: 'ep', video: 'sample.mp4', schedule: '2026-12-01T18:00:00+08:00', platforms: { kuaishou: { caption: '作品描述\n#话题' } }
  } }, { platforms: ['kuaishou'], rootPath: '/temp', shouldStop: () => false, onChange() {} });
  assert.equal(caption.innerText, '作品描述\n#话题');
  assert.equal(states.kuaishou.status, '需人工补齐');
  assert.match(states.kuaishou.review.join(), /手动核对定时/);
  assert.equal(keys + clicks, 0);
});

test('上传页只有本地预览或重新上传提示时，不报完成', () => {
  for (const id of ['acfun', 'kuaishou']) {
    const editable = { name: 'title desc', getAttribute: () => '', getClientRects: () => [1] };
    const page = vm.createContext({
      location: new URL(ADAPTERS[id].url),
      document: {
        body: { innerText: '重新上传' },
        querySelectorAll: s => s.includes('_button-primary_') ? [] : [editable],
        querySelector: () => ({ readyState: 4, currentSrc: 'blob:preview' })
      }
    });
    assert.equal(vm.runInContext(ADAPTERS[id].uploadDone, page), false);
    page.document.body.innerText = '视频上传失败';
    assert.equal(vm.runInContext(ADAPTERS[id].uploadError, page), true);
    assert.equal(vm.runInContext(ADAPTERS[id].uploadDone, page), false);
  }
});

test('A 站稿件管理直接读当前视频列表，不回到投稿首页', () => {
  const links = ADAPTERS.acfun.links;
  const page = vm.createContext({
    location: new URL(links.url),
    document: { body: { innerText: '视频稿件' }, querySelector: s => s === '.c-content-list' ? {} : null, querySelectorAll: () => [] }
  });
  assert.equal(new URL(links.url).pathname, '/video-history');
  assert.ok(vm.runInContext(links.ready, page));
});

test('快手视频表单就绪且上传进度已退出后才确认接收', () => {
  const render = { activeProgress: true };
  const shown = { getClientRects: () => [1] };
  const editable = { ...shown, getAttribute: () => '', innerText: '' };
  const main = { ...shown, className: '_button_3a3 _button-primary_3a3', innerText: '发布', getAttribute: () => null };
  const page = vm.createContext({
    location: new URL(ADAPTERS.kuaishou.url),
    document: {
      body: { get innerText() { return render.activeProgress ? '上传中\n重新上传' : '预览封面\n重新上传'; } },
      querySelector: s => s.includes('video') && !s.includes('cover') ? { ...shown, videoWidth:1280, readyState:4 } : s.includes('cover') ? shown : null,
      querySelectorAll: s => s.includes('_button-primary_') ? [main] : s.includes('contenteditable') ? [editable] : [],
    },
  });
  assert.equal(vm.runInContext(ADAPTERS.kuaishou.uploadDone, page), false);
  render.activeProgress = false;
  assert.equal(vm.runInContext(ADAPTERS.kuaishou.uploadDone, page), true);
});
