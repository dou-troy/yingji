/**
 * 映集 - 数据源配置中心
 * 所有第三方接口的 key、地址、开关集中在此，改这里即可接入真实数据源。
 */

module.exports = {
  server: {
    port: process.env.PORT || 3000,
  },

  // ===== 视频元数据：豆瓣公开接口（默认，国内直连，无需 key）=====
  // 数据来源：https://movie.douban.com/j/subject_suggest?q={kw}
  // 合法稳定，覆盖电影/剧集元数据（片名、海报、年份、豆瓣词条链接）。
  douban: {
    enabled: true,
    baseUrl: "https://movie.douban.com/j/subject_suggest",
  },

  // ===== 视频元数据：TMDB（可选备用，需代理访问，免费需注册 key）=====
  // 注册地址：https://developer.themoviedb.org/docs/getting-started
  // 国内直连通常不可达，需要本地代理；有代理时改 enabled=true 即可作为备用源。
  tmdb: {
    enabled: false, // 国内无法直连，默认关闭；有代理时可开启
    apiKey: "b69aba0bba5cc5bf8d8ead7d00c9bf4a", // TMDB API Key (v3)
    baseUrl: "https://api.themoviedb.org/3",
    imageBaseUrl: "https://image.tmdb.org/t/p",
    language: "zh-CN",
  },

  // ===== 视频元数据：哔哩哔哩公开搜索接口（国内直连，无需 key）=====
  // 数据来源：https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={kw}
  // 返回视频元数据（标题/作者/BV号/封面/时长），用于内嵌官方播放器。
  bilibili: {
    enabled: true,
    baseUrl: "https://api.bilibili.com/x/web-interface/search/type",
  },

  // ===== 音乐元数据：网易云公开搜索接口（国内直连，无需 key）=====
  // 数据来源：https://music.163.com/api/search/get/web?s={kw}&type=1
  // 返回歌曲元数据（歌名/歌手/专辑/时长/封面），合法稳定。
  music: {
    enabled: true, // 已启用真实音乐检索
    baseUrl: "https://music.163.com/api/search/get/web",
    provider: "netease", // netease | qq
  },

  // ===== 音乐元数据：QQ音乐公开搜索接口（国内直连，无需 key）=====
  // 数据来源：https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={kw}&format=json
  // 返回歌曲元数据（歌名/歌手/专辑/时长/封面）。
  qqmusic: {
    enabled: true, // 已启用 QQ 音乐检索
    baseUrl: "https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
  },

  // ===== 平台直达链接（官方搜索页，无需 key，稳定合法）=====
  // 用于生成「去观看/去收听」的真实跳转链接。
  platforms: {
    video: [
      { name: "腾讯视频", searchUrl: "https://v.qq.com/x/search/?q={kw}" },
      { name: "爱奇艺", searchUrl: "https://so.iqiyi.com/so/q_{kw}" },
      { name: "优酷", searchUrl: "https://so.youku.com/search_video/q_{kw}" },
      { name: "芒果TV", searchUrl: "https://so.mgtv.com/so?k={kw}" },
      { name: "哔哩哔哩", searchUrl: "https://search.bilibili.com/all?keyword={kw}" },
    ],
    music: [
      { name: "QQ音乐", searchUrl: "https://y.qq.com/n/ryqq/search?w={kw}" },
      { name: "网易云音乐", searchUrl: "https://music.163.com/#/search/m/?s={kw}" },
    ],
  },
};
