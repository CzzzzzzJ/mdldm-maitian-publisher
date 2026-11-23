import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, PLATFORMS } from '../lib/bundle.js';

function schedule() {
  const bj = new Date(Date.now() + 3 * 86400e3 + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  const y = bj.getUTCFullYear(), m = p(bj.getUTCMonth() + 1), d = p(bj.getUTCDate());
  return `${y}-${m}-${d}T18:00:00+08:00`;
}

function project(zhihu) {
  return {
    version: 1,
    video: '成片.mp4',
    covers: { '16x9': '封面/cover-16x9.jpg' },
    schedule: schedule(),
    platforms: { zhihu },
  };
}

const files = new Set(['成片.mp4', '封面/cover-16x9.jpg']);
const zhihuErrors = (body) => validate(project(body), files).errors.filter((e) => e.startsWith('知乎'));

test('知乎规则：标题至少 5 字、最多 50 字，话题最多 6 个，可以放链接', () => {
  assert.equal(PLATFORMS.zhihu.name, '知乎');
  assert.deepEqual(PLATFORMS.zhihu.fields.title, [5, 50]);
  assert.equal(PLATFORMS.zhihu.maxTopics, 6);
  assert.equal(PLATFORMS.zhihu.links, true);
});

test('标题太短、太长或话题超限会被拦住', () => {
  const ok = { covers: ['16x9'], title: '知乎视频标题够长', body: '简介里有 https://example.com/a', topics: ['效率'] };
  assert.deepEqual(zhihuErrors(ok), []);
  assert.match(zhihuErrors({ ...ok, title: '太短' }).join('\n'), /至少 5 字/);
  assert.match(zhihuErrors({ ...ok, title: '题'.repeat(51) }).join('\n'), /超过上限 50/);
  assert.match(zhihuErrors({ ...ok, topics: ['一', '二', '三', '四', '五', '六', '七'] }).join('\n'), /最多 6 个/);
});

test('适配器登记在发布顺序里，并且不会去点发布', () => {
  const adapter = readFileSync(new URL('../lib/platforms/zhihu.js', import.meta.url), 'utf8');
  const pub = readFileSync(new URL('../lib/publish.js', import.meta.url), 'utf8');
  assert.match(adapter, /id:\s*'zhihu'/);
  assert.match(adapter, /https:\/\/www\.zhihu\.com\/zvideo\/upload-video/);
  assert.doesNotMatch(adapter, /clickTextLike\([^)]*'发布'/);
  assert.doesNotMatch(adapter, /byText\('发布'\)/);
  assert.match(pub, /import zhihu from '\.\/platforms\/zhihu\.js'/);
  assert.match(pub, /ORDER = \[[^\]]*'zhihu'/);
  assert.doesNotMatch(adapter, /closest\('article,li,div'\)/);
  assert.match(adapter, /querySelectorAll\('a\[href\*="zvideo"\]'\)\.length > 1/);
});
