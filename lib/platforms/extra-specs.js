// 知识站图文课的字数。视频课只要求标题，避免旧工程被新字段拦住。
export const specs = {
  zsz: {
    name: '知识站',
    fields: { title: [1, 120] },
    article: { fields: { series: [1, 80], title: [1, 120], summary: [1, 500], body: [1, 100000] } },
    links: true,
  },
};
