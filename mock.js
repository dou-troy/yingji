/**
 * 模拟数据兜底 —— 当真实数据源未配置或请求失败时降级使用。
 * 保证页面在任何情况下都可演示、可交互。
 */
const config = require("./config");

const MOCK_DB = [
  { name: "流浪地球 3", type: "电影", year: "2027", poster: "#3b82f6", rating: "8.7", keyword: ["流浪地球", "流浪地球3"] },
  { name: "庆余年 第二季", type: "电视剧", year: "2024", poster: "#8b5cf6", rating: "8.9", keyword: ["庆余年", "庆余年2"] },
  { name: "最伟大的作品", type: "音乐", year: "2022", poster: "#f59e0b", rating: null, keyword: ["周杰伦", "周杰伦新歌", "最伟大的作品"] },
  { name: "开端", type: "电视剧", year: "2022", poster: "#ef4444", rating: "8.6", keyword: ["开端"] },
  { name: "狐妖小红娘", type: "动漫", year: "2024", poster: "#ec4899", rating: "8.2", keyword: ["狐妖小红娘", "狐妖"] },
  { name: "披荆斩棘 第四季", type: "综艺", year: "2024", poster: "#10b981", rating: "8.1", keyword: ["披荆斩棘", "披荆斩棘4"] },
];

function normalize(s) {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

function search(keyword) {
  const kw = normalize(keyword);
  if (!kw) return [];
  return MOCK_DB.filter((item) =>
    item.keyword.some((k) => normalize(k).includes(kw) || kw.includes(normalize(k)))
  ).map((item) => {
    const isMusic = item.type === "音乐";
    const links = (isMusic ? config.platforms.music : config.platforms.video).map((p) => ({
      name: p.name,
      url: p.searchUrl.replace("{kw}", encodeURIComponent(item.name)),
    }));
    return {
      id: `mock-${item.name}`,
      name: item.name,
      type: item.type,
      year: item.year,
      poster: item.poster,
      rating: item.rating,
      overview: "",
      platforms: links,
      source: "mock",
    };
  });
}

module.exports = { search };
