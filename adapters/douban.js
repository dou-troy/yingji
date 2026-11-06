/**
 * 视频数据源适配器 —— 豆瓣公开搜索接口（国内直连，无需 key）
 *
 * 数据来源：豆瓣官方搜索联想接口
 *   GET https://movie.douban.com/j/subject_suggest?q={keyword}
 * 返回 JSON：片名、海报、年份、类型、豆瓣词条链接。
 *
 * 说明：这是豆瓣官网自带的公开接口，合法、稳定、国内可直连，
 * 覆盖电影/剧集元数据，但不提供「在哪个视频平台可播放」的数据，
 * 该部分由 buildPlatformLinks 生成各平台官方搜索页直达链接补齐。
 */
const config = require("../config");

class DoubanAdapter {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get enabled() {
    return !!this.cfg && this.cfg.enabled !== false;
  }

  _type(item) {
    // 豆瓣 suggest 接口的 type 字段：movie / tv（剧集统一归为"电视剧"）
    if (item.type === "movie") return "电影";
    if (item.type === "tv") return "电视剧";
    return item.type || "影视";
  }

  _map(item) {
    return {
      id: `douban-${item.id}`,
      name: item.title || "",
      type: this._type(item),
      year: item.year || "",
      poster: item.img || null,
      rating: null, // suggest 接口不含评分，详情页另行获取
      overview: "",
      url: item.url || `https://movie.douban.com/subject/${item.id}/`,
    };
  }

  /**
   * 搜索影视，返回统一结构数组。
   */
  async search(keyword) {
    const url = `${this.cfg.baseUrl}?q=${encodeURIComponent(keyword)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://movie.douban.com/",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Douban ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    if (!Array.isArray(data)) {
      throw new Error("Douban 返回格式异常");
    }

    const items = data.slice(0, 16).map((item) => this._map(item));

    // 批量补评分（subject_abstract 接口），失败不影响主流程
    await this._fillRatings(items);

    return items;
  }

  /**
   * 批量补齐评分：用 subject_abstract 接口逐个获取 rate。
   * 为控制请求量，限制并发与条数；失败静默降级（rating 保持 null）。
   */
  async _fillRatings(items) {
    const targets = items.filter((i) => i.id && i.id.startsWith("douban-"));
    // 最多补前 8 条，避免请求过多
    const limited = targets.slice(0, 8);
    await Promise.allSettled(
      limited.map(async (item) => {
        const doubanId = item.id.replace("douban-", "");
        try {
          const r = await this._abstract(doubanId);
          if (r && r.rate) {
            item.rating = r.rate;
            item.star = r.star;
          }
        } catch (e) {
          // 单条失败忽略
        }
      })
    );
  }

  /**
   * 获取单部影视的评分摘要（subject_abstract 接口）。
   */
  async _abstract(doubanId) {
    const url = `https://movie.douban.com/j/subject_abstract?subject_id=${doubanId}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://movie.douban.com/",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.subject ? data.subject : null;
  }

  /**
   * 获取影视详情（移动端 rexxar 接口，字段完整）。
   * 返回：{ title, original_title, rating, rating_count, year, card_subtitle,
   *        intro, genres, directors, actors, countries, durations, pubdate,
   *        poster, url }
   */
  async detail(doubanId) {
    const url = `https://m.douban.com/rexxar/api/v2/movie/${doubanId}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        Referer: "https://m.douban.com/",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Douban detail ${resp.status}`);
    }

    const d = await resp.json();
    return {
      id: `douban-${d.id || doubanId}`,
      name: d.title || "",
      original_title: d.original_title || "",
      type: d.is_tv ? "电视剧" : "电影",
      year: d.year || (d.pubdate && d.pubdate[0] ? d.pubdate[0].slice(0, 4) : ""),
      rating: d.rating ? d.rating.value : null,
      rating_count: d.rating ? d.rating.count : null,
      star: d.rating ? d.rating.star_count : null,
      card_subtitle: d.card_subtitle || "",
      intro: d.intro || "",
      genres: d.genres || [],
      directors: d.directors || [],
      actors: (d.actors || []).slice(0, 12),
      countries: d.countries || [],
      durations: d.durations || [],
      pubdate: d.pubdate || [],
      poster: d.cover_url || d.pic || null,
      url: d.url || `https://movie.douban.com/subject/${doubanId}/`,
    };
  }

  /**
   * 获取榜单（豆瓣 TOP250 / 分类榜）。
   * type: 11=电影, 5=电视剧 等；interval 见豆瓣分类。
   */
  async ranking(type = 11, limit = 20) {
    const url = `https://movie.douban.com/j/chart/top_list?type=${type}&interval_id=100:90&action=&start=0&limit=${limit}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://movie.douban.com/",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Douban ranking ${resp.status}`);
    }

    const list = await resp.json();
    return (list || []).map((x) => ({
      id: `douban-${x.id}`,
      name: x.title || "",
      type: type === 5 ? "电视剧" : "电影",
      year: x.release_date ? String(new Date(x.release_date).getFullYear()) : "",
      rating: x.score ? String(x.score) : null,
      star: x.rating ? x.rating[0] : null,
      poster: x.cover_url || x.cover || null,
      regions: x.regions || [],
      types: x.types || [],
      actors: x.actors || [],
      vote_count: x.vote_count || null,
      url: x.url || "",
    }));
  }

  /**
   * 生成「去哪看」的平台直达链接（视频类平台）。
   */
  buildPlatformLinks(keyword) {
    return config.platforms.video.map((p) => ({
      name: p.name,
      url: p.searchUrl.replace("{kw}", encodeURIComponent(keyword)),
    }));
  }
}

module.exports = DoubanAdapter;
