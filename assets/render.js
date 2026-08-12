/* ============================================
   渲染模块 —— 纯字符串处理，无 DOM 依赖
   构建脚本（Node）与浏览器（运行时）共用同一份逻辑，
   避免预渲染产物与客户端重渲染结果不一致
   ============================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Render = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const ICON_EXTERNAL = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M10 2h4v4M14 2 7.5 8.5"/></svg>`;
  const ICON_DETAIL = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7"/></svg>`;

  /* 卡片色块调色板：低饱和、明度接近，保证白色首字母始终可读 */
  const AVATAR_COLORS = [
    ["#6366f1", "#818cf8"],
    ["#0ea5e9", "#38bdf8"],
    ["#14b8a6", "#2dd4bf"],
    ["#f59e0b", "#fbbf24"],
    ["#ec4899", "#f472b6"],
    ["#8b5cf6", "#a78bfa"],
    ["#ef4444", "#f87171"],
    ["#10b981", "#34d399"],
    ["#0891b2", "#22d3ee"],
    ["#7c3aed", "#9d7bf6"],
  ];

  /** 单个模型标签在两行内大致能放下的数量，超出折叠为 +N */
  const MAX_VISIBLE_TAGS = 4;

  const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  /**
   * URL 白名单：仅放行 HTTPS。
   * 注册链接会处理账号与凭据，不收录明文 HTTP；同时阻止 javascript:
   * 与 data: 等可执行伪协议——HTML 转义无法防御此类 href。
   */
  function isSafeUrl(url) {
    try {
      return new URL(String(url)).protocol === "https:";
    } catch {
      return false;
    }
  }

  /** 不安全的链接降级为无跳转，避免渲染出可点击的恶意 href */
  function safeHref(url) {
    return isSafeUrl(url) ? escapeHtml(url) : "#";
  }

  /** 统一换行符并压缩连续空行，避免粘贴文本破坏 pre-wrap 排版 */
  function normalizeText(text) {
    return String(text ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** note 与 description 均按纯文本展示，仅转义不做链接识别 */
  function renderText(text) {
    return escapeHtml(normalizeText(text));
  }

  /** 字符串稳定哈希：同一平台名永远得到同一个颜色 */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  /** 取平台名首个有意义字符：中文取首字，英文取首字母 */
  function getInitial(title) {
    const trimmed = String(title ?? "").trim();
    return trimmed ? trimmed[0] : "?";
  }

  function renderAvatar(title, size) {
    const [from, to] = AVATAR_COLORS[hashString(title) % AVATAR_COLORS.length];
    const sizeClass = size === "lg" ? " avatar-lg" : "";
    return `<div class="card-avatar${sizeClass}" style="background:linear-gradient(135deg, ${from}, ${to});" aria-hidden="true">${escapeHtml(
      getInitial(title)
    )}</div>`;
  }

  /** 从 URL 提取主机名，作为标题下方的副标题 */
  function getDomain(url) {
    try {
      return new URL(String(url)).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function renderModelTags(models, limit) {
    if (!models || !models.length) return "";
    const max = limit ?? MAX_VISIBLE_TAGS;
    const visible = models.slice(0, max);
    const hidden = models.length - visible.length;
    const tags = visible
      .map((m) => `<span class="model-tag">${escapeHtml(m)}</span>`)
      .join("");
    const more =
      hidden > 0 ? `<span class="model-tag more">+${hidden}</span>` : "";
    // 加标注说明这些是什么，避免访客不理解标签含义
    return `<div class="model-block"><span class="model-label">免费高级模型</span><div class="model-tags">${tags}${more}</div></div>`;
  }

  /** 投稿人：填了才显示，自动补全为 github.com/xxx */
  function renderPoster(name) {
    if (!name) return `<span class="meta-poster"></span>`;
    return `<span class="meta-poster">投稿人 <a href="https://github.com/${encodeURIComponent(
      name
    )}" target="_blank" rel="noopener">${escapeHtml(name)}</a></span>`;
  }

  /** 详细描述可留空，此时回退到简短描述 */
  function getDescription(item) {
    return item.description || item.note;
  }

  function renderCard(item) {
    const domain = getDomain(item.url);
    // 卡片上的 note 保持纯文本，不做链接识别
    return `<article class="bento-card" data-id="${escapeHtml(item.id)}">
      <div class="card-head">
        ${renderAvatar(item.title)}
        <div class="card-headings">
          <h2 class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(
      item.title
    )}</h2>
          ${
            domain
              ? `<span class="card-domain">${escapeHtml(domain)}</span>`
              : ""
          }
        </div>
      </div>
      ${renderModelTags(item.free_premium_model)}
      <p class="card-note">${renderText(item.note)}</p>
      <div class="card-foot">
        <span class="foot-left">${renderPoster(item.poster_githubname)}</span>
        <time datetime="${escapeHtml(item.updatetime)}">${escapeHtml(
      item.updatetime
    )}</time>
      </div>
      <div class="card-actions">
        <button class="card-action" data-detail="${escapeHtml(item.id)}">
          ${ICON_DETAIL} 详情
        </button>
        <a class="card-action primary" href="${safeHref(
          item.url
        )}" target="_blank" rel="noopener">
          ${ICON_EXTERNAL} 前往注册
        </a>
      </div>
    </article>`;
  }

  function renderList(items) {
    if (!items.length) {
      return `<div class="empty-state">没有匹配的平台，换个关键词试试</div>`;
    }
    return items.map(renderCard).join("");
  }

  /** status_bool 为 false 的条目不展示；顺序由管理员维护的 id 决定 */
  function selectVisible(platforms) {
    return (platforms || [])
      .filter((item) => item.status_bool)
      .sort((a, b) => a.id - b.id);
  }

  return {
    MAX_VISIBLE_TAGS,
    escapeHtml,
    isSafeUrl,
    safeHref,
    normalizeText,
    renderText,
    renderAvatar,
    getDomain,
    renderModelTags,
    renderPoster,
    getDescription,
    renderCard,
    renderList,
    selectVisible,
  };
});
