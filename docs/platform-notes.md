# 各平台上传页实测记录

> 2026-11-04 用第 30 期（Grok Bot Day 3，1698×1080 横屏，17:48，1.55GB）在真实上传页跑通。
> 全部用 chrome.debugger（CDP）完成：文件用 `DOM.setFileInputFiles` 交本地路径，文字用 `Input.insertText` + 真实回车，
> 需要悬停/点击的地方用 `Input.dispatchMouseEvent`。开发时用 `tools/` 下的桥接脚本驱动。

## 后台模式与定时发布（v0.2.1，2026-11-04 用第 31 期情绪之城实测）

- 填写流程跑在扩展后台（service worker），上传页用 `active:false` 在后台打开，调试器开 `Emulation.setFocusEmulationEnabled` 让后台页也能正常输入。
- 后台标签页不渲染画面：**B 站封面编辑器**（要画布裁剪）在后台做不成，改为 `withFocus` 短暂切到前台；其余平台（小红书悬停编辑封面、抖音、视频号、YouTube、X）在后台都正常。
- 每个封面、定时步骤都回读确认，避免「日志说成功、实际没设上」。
- 关含未保存内容的上传页会弹「离开此网站？」，会卡住整个浏览器的消息响应；开发时关标签页要先处理掉这个弹窗。

| 平台 | 定时控件 | 做法 |
|---|---|---|
| B 站 | `.time-container` 开关 + 自定义日历/时间面板（时区默认 UTC+08:00） | 开关 `.click()`；日期格子、时/分列表要合成完整鼠标事件（`fire`）；跨月点 `.next-btn-day` |
| 小红书 | `.post-time-switch-container` 开关 + 可输入的日期框 | 开关合成鼠标事件；框里全选后输入 `2026-11-05 18:00` 回车 |
| 抖音 | 「定时发布」单选 + Semi 日期框（2 小时后～14 天内） | 输入 `2026-11-05 18:00` 回车，Esc 收起日历 |
| 视频号 | 「定时」单选 + WeUI 日历 + 时/分两列 | 日期框合成鼠标事件打开，点日期 `<a>`，再点时、分 |
| YouTube | 最后一步「公开范围」→「安排时间」 | 先选「不是面向儿童」，点 `button[test-id=REVIEW]`，展开 `#second-container-expand-button`，日期弹窗输入 `2026年11月5日`，时间框输入 `18:00`；时区默认 GMT+0800 |
| X | 发帖框 `scheduleOption` → 月/日/年/时/分 5 个 select | 原生 setter 设值 + change，点 `scheduledConfirmationPrimaryAction`，确认出现「Will send on…」 |

## 通用经验

- **文件输入框**：用 JS 表达式找到元素，再按 `objectId` 交给 `DOM.setFileInputFiles`（`tools/setfiles.mjs` 的 `setFilesByExpr`）。这样能穿透 Shadow DOM，大视频也不经过 JS 内存。
- **文字**：React/Vue 受控输入框用 focus + `Input.insertText` 最稳；多行正文逐行插入，行间按真实回车。
- **话题/标签**：大多数平台要靠联想下拉选中才算真话题；只选「完全同名」的项，没有同名就保留为普通文字并在报告里提示。
- **封面**：小红书、视频号要等视频**上传完**才能编辑封面；B 站、抖音上传中就能改。
- **调试器限制**：页面里有别的扩展注入的 `chrome-extension://` iframe 时无法 attach（YouTube 上的 YouMind 侧边栏）。只在该标签页移除那个节点即可（刷新会恢复）。正式插件里要给出提示或自动处理。
- **带宽**：6 个平台同时传 1.5GB，各家速度掉到 0.5–3MB/s。插件可以考虑排队上传或提示预计时间。

## B 站专栏 `member.bilibili.com/york/read-editor`

`bilibili.mode` 为 `article` 时打开专栏编辑页，填标题、正文、标签。有 4:3 且找得到图片框才传头图。定时是「定时发布」开关，点日期后再点小时、分钟，最后要点时间弹层里的「确定」；点到弹层外面会丢掉时间。不点提交。专栏发出后不能改。标题 40 字，正文 200–20000 字。

## B 站 `member.bilibili.com/platform/upload/video/frame`

| 项 | 做法 |
|---|---|
| 视频 | `.bcc-upload-wrapper input[type=file]` |
| 标题 | `input[placeholder="请输入稿件标题"]`，原生 setter + input 事件 |
| 简介 | 第一个 `.ql-editor`（placeholder 以「填写更全面」开头），`closest('.ql-container').__quill.setText()` |
| 标签 | 先点 `.tag-pre-wrp .label-item-v2-container svg.close` 删掉自动标签；再在 `input[placeholder="按回车键Enter创建标签"]` 逐个 insertText + 回车。**「AIAgent」会被静默拒绝** |
| 封面 | 点 `.cover-module-main .cover-empty-pill` 打开「封面制作」→ 勾「双比例同步改动」→ 传 4:3 → 点「完成」。若弹出「确认同步」，点它后再点一次「完成」。关未完成的弹窗要点 `.cover-editor-head-close` |
| 创作声明 | `.creation-statement-container .bcc-select-input-inner`，选「内容无需标注」。不要去点分区那个 `.select-controller` |
| 标签 | 「测试」是活动专用词，平台会拒，跳过并记下原因。分区仍固定「人工智能」 |

## 小红书 `creator.xiaohongshu.com/publish/publish?source=official&target=video`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file]`（页面渲染后才出现） |
| 标题 | `input[placeholder="填写标题会有更多赞哦"]`，原生 setter |
| 正文 | `.tiptap.ProseMirror`，逐行 insertText + 回车 |
| 话题 | 输入 `#话题` → 等 1.5s → 点 `.item` 中首行完全等于 `#话题` 的项，生成 `a.tiptap-topic`。「Prompt」没有联想结果 |
| 封面 | 视频传完后：真实鼠标悬停 `.cover .default` → 点 `.cover-edit-entry-text`（编辑封面）→ 传图 `input[accept*=image]` → 左侧「裁剪」→ 比例选「3:4」（横屏视频默认 4:3 会裁掉竖封面）→ 完成。出现「封面效果评估通过」 |
| 弹窗 | 首次会有「PK 封面」引导，点「我知道了」 |

## 小红书图文 `creator.xiaohongshu.com/publish/publish?source=official&target=image`

同一创作者后台。`publish.json` 里 `xhs.mode` 为 `images` 时，填写阶段从视频页切到这个地址。不点发布。第一张图就是封面，不再裁 3:4。

| 项 | 做法 |
|---|---|
| 图片 | 按顺序一张一张传，最多 18 张。第一张投 `.upload-input`，之后这个框会消失，改投 `input[type=file]` 里 accept 含图片的那个 |
| 张数 | 回读 `.img-preview-area .pr`，少一张就失败 |
| 标题正文话题定时 | 与视频笔记相同：`input[placeholder="填写标题会有更多赞哦"]`、`.tiptap.ProseMirror`、`.item`、定时开关 |
| 登录 | 未登录会停在短信登录页，不填、不点发布。本机试跑时创作者后台未登录，上传框选择器来自图文页的公开记录，登录后若对不上再改这里 |

## 小红书长文

同一发布页上的「写长文」，不是图文轮播。`xhs.mode` 为 `article` 时走这里。不点发布。

| 项 | 做法 |
|---|---|
| 入口 | 点文字「写长文」，再点「新的创作」 |
| 标题 | `.edit-page textarea.d-text` 或 `textarea[placeholder="输入标题"]`，原生 setter，仍按 20 字校验 |
| 正文 | `.rich-editor-content .tiptap.ProseMirror`，逐行插入。上限按 2 万字，不再用视频笔记的 1000 字 |
| 排版 | 找得到就点「一键排版」→「简约基础」→「下一步」，停在发布前。找不到就留在编辑页，并记一条提示 |
| 定时 | 只有「下一步」之后出现和视频笔记相同的定时开关时才填 |
| 登录 | 和视频、图文一样，短信登录页直接停。本机未登录，编辑器选择器来自长文页的公开记录，登录后若对不上再改这里 |

## 抖音文章

`douyin.mode` 为 `article` 时从创作者中心首页点「发布文章」（没有就先点「高清发布」）。标题、正文、话题和定时沿用视频表单。有封面就传，没有不让整期失败。不点发布。正文按 8000 字校验。

| 未在登录后核对 | 「发布文章」入口和文章编辑器还没在已登录的创作者中心重跑。对不上时填写失败 |

## 抖音图文 `creator.douyin.com/creator-micro/content/post/image?type=new`

`douyin.mode` 为 `images` 时从视频上传页切到这个地址。一次选入头部那份图片，再填原来的标题、描述、话题、定时。不选视频封面，不点发布。标题按 20 字校验。

| 项 | 做法 |
|---|---|
| 图片 | `input[type=file]` 里 accept 含 image 的那个，一次传入 |
| 张数 | `[class*=preview] img`、`[class*=image-card]`、`[class*=upload-card] img` |
| 登录 | 扫码登录页直接停 |
| 未在登录后核对 | 上传框和张数选择器来自图文发布页的公开结构，登录后若对不上再改这里 |

## 抖音 `creator.douyin.com/creator-micro/content/upload`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file]`（唯一一个） |
| 标题 | `input[placeholder="填写作品标题，为作品获得更多流量"]`，focus + insertText（≤30） |
| 简介 | `.editor-kit-container[contenteditable=true]`，逐行 insertText + 回车 |
| 话题 | **最多 5 个**（第 6 个起不会变成话题）。逐字输入 `#话题`（整串 insertText 时联想会停在第一个字的结果）→ 用**真实鼠标**点 `[class*=mention-suggest-item-container] > div > [class*=tag-hash]` 中首行完全匹配的项（2026-11-12：外层 container 包着全部项，`.click()` 不再生成话题）。生成后编辑器里是 `[data-mention]` 节点 |
| 封面 | 点「选择封面」打开弹窗（「设置横封面」「设置竖封面」两个页签）。**要用标签文字为「上传封面」的那个 `semi-upload-hidden-input`**（按页面顺序是第 4 个文件输入框，第 2 个是「生成参考图」，别传错）。横页签传 4:3，切到竖页签再传 3:4（切换时会先把横封面同步过去，再覆盖）→ 完成 |
| 未处理 | 合集、自主声明 |

## 视频号图文

`channels.mode` 为 `images` 时，在发表页点「图文」，不走视频上传。图片按顺序一张一张传，第一张就是封面。短标题、描述、话题、定时沿用视频表单。不点发布。

| 项 | 做法 |
|---|---|
| 入口 | Shadow DOM 里文字为「图文」的节点 |
| 图片 | `input[type=file]` 里 accept 含 image 的那个 |
| 张数 | 宽度大于 48 的 `img` |
| 未在登录后核对 | 图文页签和缩略图选择器还没在已登录的视频号助手上重跑 |

## 视频号 `channels.weixin.qq.com/platform/post/create`

整个表单在 `wujie-app` 的 Shadow DOM 里：`R = document.querySelector('wujie-app').shadowRoot`。

| 项 | 做法 |
|---|---|
| 视频 | `R` 里的 `input[type=file][accept^=video]` |
| 短标题 | `input[placeholder="填写短标题有机会获得更多流量"]`，focus + insertText |
| 描述 | `.input-editor`（contenteditable），逐行 insertText + 回车 |
| 话题 | 直接输入 `#话题 `（空格分隔），自动高亮为话题，不用选联想 |
| 封面 | 视频传完后：点 `.vertical-cover-wrap .edit-btn`（个人主页卡片 3:4）→ 传图 → 确认；点 `.horizon-cover-wrap .edit-btn`（分享卡片 4:3）会先弹「使用此素材作为封面？」气泡，点「直接编辑」→ 传图 → 确认 |
| 未处理 | 原创声明、合集、位置（默认带了「杭州市」） |

## YouTube 帖子

`youtube.mode` 为 `article` 时从 Studio「创建 → 创建帖子」进频道 Posts 页（去掉 `show_create_dialog`，那个弹窗是图片帖）。正文写进 `#contenteditable-root`。定时在发帖框的 Action menu → Schedule post，日期输入、时间按 15 分钟一档点选。不点 Post / Schedule。标题和简介仍按 100 和 5000 字校验。

## YouTube `studio.youtube.com/.../videos/upload`

| 项 | 做法 |
|---|---|
| 视频 | `input[type=file][name=Filedata]`；上传后自动「已保存为私享视频」 |
| 标题/说明 | `#textbox[contenteditable]` 第 1、2 个；selectAllChildren 后 insertText，说明逐行回车 |
| 缩略图 | `input[type=file]` 且 accept 含 image；用 `cover-16x9.jpg`（1920×1080，≤2MB） |
| 标签 | 点 `#toggle-button`（显示更多）→ `input[aria-label="标签"]` 逐个 insertText + 回车（直接插入带逗号的整串不会切分） |
| 未处理 | 「是否面向儿童」（必填）、播放列表、公开范围 |
| 注意 | 页面有 YouMind 注入的 iframe 时调试器挂不上 |

## X 长文

`x.mode` 为 `article` 时打开 `x.com/compose/articles`，新建长文。这一节的第一行做标题，其余做正文；只有一段时正文用全文。写入复用长文编辑器引擎，不挂视频，不点 Publish。正文仍按 25000 字校验，不再按 280 字提醒。账号没有 Premium（蓝标未生效）时这个地址是 Page not found，侧栏也没有 Articles，直接停，不改去发普通帖。

## X 多图

`x.mode` 为 `images` 时仍打开 `x.com/compose/post`。正文照旧，图片交给 `input[data-testid=fileInput]`，不挂视频。张数回读 `[data-testid=tweetPhoto]`。定时和自动提交与视频帖相同。

| 未在登录后核对 | 多图预览的 testid 还没在已登录的发帖框里重跑。对不上时填写会报张数不够 |

## X `x.com/compose/post`

| 项 | 做法 |
|---|---|
| 正文 | `[data-testid=tweetTextarea_0]`，逐行 insertText + 回车 |
| 视频 | `input[data-testid=fileInput]`（accept 含 video/mp4）；17:48 的视频可以挂上（账号有 Premium） |
| 注意 | 不点 Post；关掉对话框会丢失 |

## 知识站图文课

`zsz.mode` 为 `article` 时打开站点后台 `/admin/catalog` 里的「创建一节课」。系列按名称选中，内容类型选图文课，填课时名称、简介和正文。免费对应公开，VIP 对应会员。网址标识留空给人填。不点「创建课时」或「发布」。表单字段按 Knowledge Kit 的内容管理页。视频建课不走这里。

| 未在登录后核对 | 这台仓库没有原来的视频建课页面。图文课选择器还没在已登录的主站后台重跑 |

## 服务号图片/文字

`mp.mode` 为 `images` 时不进文章编辑器。从公众平台首页点「新的创作 → 图片/文字」，按顺序上传头部那份图片，只填这一节的标题和正文。不要求作者、摘要、原文链接和 2.35:1 封面。正文按 1000 字校验。不点「发表」和「群发」。

| 项 | 做法 |
|---|---|
| 图片 | accept 含图片的 `input[type=file]`，一张一张传 |
| 张数 | `img[src^="blob:"]` 或 `img[src*="mmbiz"]` |
| 正文 | 描述框，或仍是 ProseMirror |
| 未在登录后核对 | 首页「图片/文字」入口和编辑器选择器还没在已登录的公众平台上重跑 |

## 服务号 `mp.weixin.qq.com`（2026-11-20）

只填单篇图文，不上传成片，不点「发表」和「群发」。

| 项 | 做法 |
|---|---|
| 入口 | `appmsg_edit_v2` 新建图文（`type=77&createType=0`）。没登录时页面停在原文案「登录超时，请重新登录」，或首页「微信扫一扫，选择公众平台账号登录」，预检直接判未登录 |
| 标题 | `textarea#title`，原生 setter |
| 作者 | `#js_author_area` 里的输入框，可空 |
| 摘要 | `#js_description_area textarea` |
| 正文 | 优先 `window.__MP_Editor_JSAPI__.invoke({ apiName: 'mp_editor_set_content' })` 写纯文本段落；没有这个接口就对 `div.ProseMirror` 逐行输入 |
| 原文链接 | `#js_article_url_area input`；栏没展开就点「原文链接」 |
| 封面 | `#js_cover_area` →「选择封面」→ 本地上传 `cover-235x1.jpg`（900×383）。裁剪弹层在后台标签页里做不成时切到前台，只点弹层里的「下一步 / 确认 / 完成」 |
| 定时 | 稿子页上有「定时发表」或时间框才填，并回读。控件如果藏在「发表」弹层里就记失败，不去点「发表」 |
| 链接 | 发表记录 `appmsgpublish?sub=list`，按标题找 `mp.weixin.qq.com/s/...` |
| 未在本机核对 | 2026-11-20 egolite 没有登录服务号，上面的编辑器字段还没在已登录页面上重跑 |

## Instagram 轮播

`instagram.mode` 为 `images` 时仍从「新帖子 → 帖子」进入，一次选入全部图片，不走 Reels，也不打长视频上传补丁。裁剪有「原版」就选原版。配文和定时与视频帖相同，中控回读后点「分享」。查重和取链接看主页帖子 `/p/`，不看 Reels。

| 项 | 做法 |
|---|---|
| 图片 | 弹窗里的 `input[type=file]`，一次传入 |
| 张数 | `[role=dialog] img[src^="blob:"]` |
| 未在登录后核对 | 多图裁剪页和 blob 预览还没在已登录的创建窗口里重跑 |

## Instagram `www.instagram.com`（2026-11-15，第 4 期实测）

| 项 | 做法 |
|---|---|
| 入口 | 左侧栏 `svg[aria-label="新帖子"]` → 菜单里的「帖子」（主页统计里也有「帖子」二字，要限定横坐标在侧栏内）；都用真实鼠标点击 |
| 视频 | 弹窗里 `input[type=file][accept*=video]`；网页上传的视频一律按 Reels 发，第一次会弹「视频帖现在会以 Reels 的形式分享」，点「确定」 |
| 比例 | 裁剪页左下 `svg[aria-label="选择“裁剪”"]` → 「原版」（默认 1:1 会把横屏裁成方形） |
| 封面 | 编辑页「封面照片」的 `input[type=file][accept="image/jpeg,image/png"]`，用 `cover-16x9.jpg`；修剪默认整段，「打开声音」默认开 |
| 配文 | `[role=dialog] [contenteditable=true]`，逐行 insertText + 回车，上限 2200 字，链接点不了；末尾 `#话题` 会弹联想框，点标题栏收起（按 Esc 会关掉整个弹窗） |
| 定时 | 「定时发布内容」开关（`input[role=switch]`）→ 日期是月历（`[role=grid]` 里的 `gridcell` 按钮，「Next month」翻页）→ 时、分是 `role=spinbutton`（值在 `aria-valuenow`，不认 insertText，逐个按数字键）；打开后右上角「分享」变成「预设发布时间」 |
| 上限 | 前端常量 `PolarisCreationConstants`：Reels 最长 1200 秒、文件最大 1GB |
| 上传 | 点「分享」后才开始传：先 GET 查续传位置，再按 10MB 分块 POST（中间的 206 `PartialRequestError` 是正常的分块回应）；223MB 走代理约 7 分钟 |
| 链接 | 自己主页 `/<用户名>/reels/`，逐条打开，配文第一行对上的就是；定时中的不在列表里 |
| 注意 | **网页 bug**：查续传位置的返回已被 `PolarisInstajax` 解析成对象，上传代码又 `JSON.parse(String(e)).offset`，抛 `"[object Object]" is not valid JSON` 被吞，界面只说「无法分享帖子」，手动发也一样。适配器检测到这句代码还在时，把 `require('PolarisInstajax').get_UNTYPED` 对 `rupload_igvideo` 的返回转回字符串；补丁随页面存在，刷新页面要重新填 |

## Discord `discord.com/channels/<服务器>/<频道>`

只填普通文字频道。`discord.mode` 为 `article` 时只写消息；为 `images` 时再挂最多 10 张图。不点发送。视频在生成 `publish.json` 时跳过。

| 项 | 做法 |
|---|---|
| 地址 | `config.json` 的 `discord`，形如 `https://discord.com/channels/服务器/频道`。论坛、公告、消息线程的地址校验不通过 |
| 登录 | 预检打开 `https://discord.com/app`，跳到登录页或出现邮箱框算没登录 |
| 消息 | 频道里 `div[role=textbox][data-slate-editor=true]`，`Input.insertText` 逐行写入，换行用 Shift+Enter。单独的回车会直接发出 |
| 图片 | 发言框所在表单里的 `input[type=file]`，一次传入。张数回读「移除附件」按钮 |
| 定时 | 没有定时开关。`schedule` 只决定何时来填，人自己点发送 |
| 关掉 | 没点发送就关页面，内容不会留下 |
