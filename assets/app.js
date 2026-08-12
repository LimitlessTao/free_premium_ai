/* ============================================
   交互逻辑：搜索 / 详情弹窗 / 反馈 / 投稿
   渲染逻辑见 render.js（与构建脚本共用）
   ============================================ */

const {
  escapeHtml,
  safeHref,
  renderText,
  renderAvatar,
  getDomain,
  renderModelTags,
  renderPoster,
  getDescription,
  renderList,
  selectVisible,
} = window.Render;

let allPlatforms = [];

/* ---------- 列表渲染 ---------- */

/**
 * 标记内容被截断的卡片，用于触发渐隐遮罩。
 * 需在插入 DOM 后测量，故与渲染分离。
 */
function markClampedNotes() {
  document.querySelectorAll(".card-note").forEach((el) => {
    el.classList.toggle("is-clamped", el.scrollHeight > el.clientHeight + 1);
  });
}

function render(items) {
  const container = document.getElementById("list");
  const hint = document.getElementById("result-hint");

  container.innerHTML = renderList(items);
  hint.textContent = items.length ? `${items.length} 个平台` : "";
  markClampedNotes();
}

/* ---------- 搜索：标题、描述、模型名全文匹配 ---------- */

function search(keyword) {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return allPlatforms;
  return allPlatforms.filter((item) =>
    [
      item.title,
      item.note,
      item.description,
      ...(item.free_premium_model || []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(kw)
  );
}

/** 输入防抖，避免连续按键触发整列表重渲染 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------- 弹窗通用 ---------- */

// 记录打开弹窗的元素，关闭后把焦点还回去
let lastFocusedElement = null;

function openModal(el) {
  lastFocusedElement = document.activeElement;
  el.hidden = false;
  document.body.style.overflow = "hidden";
  // 焦点移入弹窗，否则 Tab 会跑到背景元素上
  const focusTarget = el.querySelector(
    "input, textarea, button:not(.modal-close), .modal-close"
  );
  if (focusTarget) focusTarget.focus();
}

function closeModal(el) {
  el.hidden = true;
  // 两个弹窗都关闭后才恢复滚动
  if (document.querySelectorAll(".modal-backdrop:not([hidden])").length === 0) {
    document.body.style.overflow = "";
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }
}

function setupModalDismiss(backdrop) {
  backdrop.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(backdrop));
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
}

/* ---------- 详情弹窗 ---------- */

function showDetail(item) {
  const backdrop = document.getElementById("detail-modal");
  const domain = getDomain(item.url);

  backdrop.querySelector(".detail-head").innerHTML = `
    ${renderAvatar(item.title, "lg")}
    <div class="card-headings">
      <h2 class="modal-title">${escapeHtml(item.title)}</h2>
      ${domain ? `<span class="card-domain">${escapeHtml(domain)}</span>` : ""}
    </div>`;

  backdrop.querySelector(".detail-models").innerHTML = renderModelTags(
    item.free_premium_model,
    99
  );
  // 详细描述完整展示，保留换行但不做链接识别
  backdrop.querySelector(".detail-note").innerHTML = renderText(
    getDescription(item)
  );
  backdrop.querySelector(".detail-meta").innerHTML = `
    ${renderPoster(item.poster_githubname)}
    <span>更新于 ${escapeHtml(item.updatetime)}</span>`;
  backdrop.querySelector(".detail-visit").href = safeHref(item.url);

  openModal(backdrop);
}

/* ---------- 反馈弹窗 ---------- */

function setupFeedbackModal() {
  const backdrop = document.getElementById("feedback-modal");
  document.getElementById("open-feedback").addEventListener("click", () => {
    openModal(backdrop);
  });
  setupModalDismiss(backdrop);
}

/* ---------- 投稿弹窗 ---------- */

/**
 * 重复平台按域名比对：AFF 参数不同但域名相同即为同一平台，
 * 而标题写法（中文名/英文名）不可靠。仅提示不拦截——
 * 投稿人可能是来更新失效信息的。
 */
function findDuplicate(url) {
  const domain = getDomain(url);
  if (!domain) return null;
  return allPlatforms.find((item) => getDomain(item.url) === domain) || null;
}

function setupSubmitModal() {
  const backdrop = document.getElementById("submit-modal");

  document.getElementById("open-submit").addEventListener("click", () => {
    openModal(backdrop);
  });
  setupModalDismiss(backdrop);

  // 供投稿模块调用：查重需要列表数据，展开弹窗需要焦点管理
  window.SubmitHooks = {
    findDuplicate,
    openModal: () => openModal(backdrop),
  };
}

/* ---------- 站点配置注入 ---------- */

/**
 * 预渲染已写入静态内容，此处仅补全客户端才需要的动态部分。
 * 反馈链接读取构建注入的 site-config 而非数据文件，
 * 这样测试部署可用 REPO_URL 把投稿与反馈指向测试仓库。
 */
function applySiteConfig() {
  const node = document.getElementById("site-config");
  let siteConfig = {};
  try {
    siteConfig = JSON.parse(node.textContent) || {};
  } catch {
    // 读取失败时保持现状，链接退化为占位符
  }
  const repoUrl = siteConfig.repoUrl || "";
  const issuesUrl = repoUrl ? `${repoUrl.replace(/\/$/, "")}/issues` : "#";
  document.getElementById("feedback-issue-link").href = issuesUrl;
}

/* ---------- 启动 ---------- */

async function init() {
  const res = await fetch("data/platforms.json");
  const config = await res.json();

  applySiteConfig();
  allPlatforms = selectVisible(config.platforms);

  // 预渲染已输出完整列表，无需重复渲染首屏
  markClampedNotes();

  const searchInput = document.getElementById("search");
  searchInput.addEventListener(
    "input",
    debounce((e) => render(search(e.target.value)), 120)
  );

  // 详情按钮用事件委托绑定，避免重渲染后失效
  document.getElementById("list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-detail]");
    if (!btn) return;
    const item = allPlatforms.find((p) => String(p.id) === btn.dataset.detail);
    if (item) showDetail(item);
  });

  setupModalDismiss(document.getElementById("detail-modal"));
  setupFeedbackModal();
  setupSubmitModal();

  // 投稿模块依赖上面注册的钩子，须在其后初始化
  window.SubmitPanel?.init();

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document
      .querySelectorAll(".modal-backdrop:not([hidden])")
      .forEach(closeModal);
  });

  // 窗口尺寸变化会改变换行，需重新判断截断状态
  window.addEventListener("resize", debounce(markClampedNotes, 150));
}

init();
