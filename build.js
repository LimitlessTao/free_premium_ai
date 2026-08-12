#!/usr/bin/env node
/**
 * 构建脚本：校验数据 → 预渲染卡片 → 注入站点配置与 OG 标签
 *
 * 预渲染的意义：爬虫与首屏无需等待 JS 即可获得完整内容。
 * 渲染逻辑复用 assets/render.js，保证构建产物与客户端重渲染结果一致。
 *
 * 用法：node build.js [源目录] [输出目录]
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = process.argv[2] || __dirname;
const OUT_DIR = process.argv[3] || path.join(SRC_DIR, "dist");

const Render = require(path.join(SRC_DIR, "assets/render.js"));

/* ---------- 数据校验 ---------- */

const REQUIRED_SITE_FIELDS = ["site_title", "site_sub_title", "site_description"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 静默的脏数据会让页面出错却不报警，故在构建期硬性拦截。
 * 返回错误列表，非空则终止构建。
 */
function validate(config) {
  const errors = [];

  REQUIRED_SITE_FIELDS.forEach((field) => {
    if (!config[field]) errors.push(`缺少顶层字段 ${field}`);
  });

  if (!Array.isArray(config.platforms)) {
    errors.push("platforms 必须是数组");
    return errors;
  }

  const seenIds = new Set();

  config.platforms.forEach((item, index) => {
    const label = `platforms[${index}]${item.title ? ` (${item.title})` : ""}`;

    if (typeof item.id !== "number" || !Number.isInteger(item.id)) {
      errors.push(`${label}: id 必须是整数`);
    } else if (seenIds.has(item.id)) {
      errors.push(`${label}: id ${item.id} 重复`);
    } else {
      seenIds.add(item.id);
    }

    if (!item.title) errors.push(`${label}: title 不能为空`);
    if (!item.note) errors.push(`${label}: note 不能为空`);

    // 注册链接涉及账号凭据，仅允许 HTTPS，同时阻止可执行伪协议
    if (!Render.isSafeUrl(item.url)) {
      errors.push(`${label}: url 必须是 HTTPS 链接，当前为 ${item.url}`);
    }

    if (typeof item.status_bool !== "boolean") {
      errors.push(`${label}: status_bool 必须是布尔值`);
    }

    if (!Array.isArray(item.free_premium_model)) {
      errors.push(`${label}: free_premium_model 必须是数组`);
    }

    if (!DATE_PATTERN.test(item.updatetime || "")) {
      errors.push(`${label}: updatetime 需为 yyyy-mm-dd，当前为 ${item.updatetime}`);
    }
  });

  return errors;
}

/* ---------- 模板注入 ---------- */

const { escapeHtml } = Render;

/** 用注释标记定位注入点，保持模板本身可直接在浏览器中打开调试 */
function injectSlot(html, slot, content) {
  const pattern = new RegExp(
    `(<!--\\s*${slot}:start\\s*-->)([\\s\\S]*?)(<!--\\s*${slot}:end\\s*-->)`
  );
  if (!pattern.test(html)) {
    throw new Error(`模板中找不到注入点 ${slot}`);
  }
  return html.replace(pattern, `$1${content}$3`);
}

function buildHead(config, siteUrl) {
  const title = `${config.site_title} · ${config.site_sub_title}`;
  const logo = config.site_logo_url || "";

  // OG 标签由顶层站点配置生成，保证分享预览与站点信息一致
  return `
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(config.site_description)}">
  ${logo ? `<link rel="icon" href="${escapeHtml(logo)}">` : ""}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(config.site_description)}">
  ${logo ? `<meta property="og:image" content="${escapeHtml(logo)}">` : ""}
  ${siteUrl ? `<meta property="og:url" content="${escapeHtml(siteUrl)}">` : ""}
  <meta property="og:site_name" content="${escapeHtml(config.site_title)}">
  <meta name="twitter:card" content="${logo ? "summary" : "summary_large_image"}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(config.site_description)}">
  ${logo ? `<meta name="twitter:image" content="${escapeHtml(logo)}">` : ""}`;
}

function buildBrand(config, repoUrl) {
  const logo = config.site_logo_url;
  return `
      ${
        logo
          ? `<img class="brand-mark" src="${escapeHtml(
              logo
            )}" alt="${escapeHtml(config.site_title)}">`
          : ""
      }
      <span>${escapeHtml(config.site_title)}</span>
      ${
        repoUrl
          ? `<a class="repo-inline" href="${escapeHtml(
              repoUrl
            )}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        项目开源仓库
      </a>`
          : ""
      }`;
}

function buildFooterLinks(config, repoUrl) {
  if (!repoUrl) return "";
  const issuesUrl = `${repoUrl.replace(/\/$/, "")}/issues`;
  return `
      <a href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener">仓库</a>
      ·
      <a href="${escapeHtml(issuesUrl)}" target="_blank" rel="noopener">反馈失效</a>`;
}

/**
 * 前端运行时配置。
 *
 * Turnstile Site Key 是公开值，但随部署环境变化，故由构建注入而非硬编码。
 * 内嵌于 JSON script 标签，需转义 < 以防内容提前闭合标签。
 */
function buildClientConfig(config, repoUrl) {
  const runtime = {
    repoUrl: repoUrl || "",
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || config.turnstile_site_key || "",
  };
  return JSON.stringify(runtime).replace(/</g, "\\u003c");
}

/* ---------- 主流程 ---------- */

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach((entry) => {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  });
}

function main() {
  const config = JSON.parse(
    fs.readFileSync(path.join(SRC_DIR, "data/platforms.json"), "utf8")
  );

  const errors = validate(config);
  if (errors.length) {
    console.error("数据校验失败：");
    errors.forEach((e) => console.error("  ✗ " + e));
    process.exit(1);
  }

  const visible = Render.selectVisible(config.platforms);
  const siteUrl = process.env.SITE_URL || config.site_url || "";
  // 测试部署的投稿与反馈需指向测试仓库，环境变量优先于数据文件，
  // 避免为了切换目标仓库而改动事实源
  const repoUrl = process.env.REPO_URL || config.repo_url || "";

  let html = fs.readFileSync(path.join(SRC_DIR, "index.html"), "utf8");
  html = injectSlot(html, "head", buildHead(config, siteUrl));
  html = injectSlot(html, "brand", buildBrand(config, repoUrl));
  html = injectSlot(html, "subtitle", escapeHtml(config.site_sub_title));
  html = injectSlot(html, "description", escapeHtml(config.site_description));
  html = injectSlot(html, "count", String(visible.length));
  html = injectSlot(html, "list", Render.renderList(visible));
  html = injectSlot(html, "footer-links", buildFooterLinks(config, repoUrl));
  html = injectSlot(html, "config", buildClientConfig(config, repoUrl));
  // 模板中的定位注释会保留在 script 内容里，混入 textContent 后
  // 浏览器 JSON.parse 直接失败，配置被 catch 静默吞掉，此处剥掉
  html = html.replace(
    /(<script id="site-config"[^>]*>)<!--\s*config:start\s*-->([\s\S]*?)<!--\s*config:end\s*--><\/script>/,
    "$1$2</script>"
  );

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  copyDir(path.join(SRC_DIR, "assets"), path.join(OUT_DIR, "assets"));
  copyDir(path.join(SRC_DIR, "data"), path.join(OUT_DIR, "data"));

  console.log(`✓ 校验通过，${config.platforms.length} 条数据`);
  console.log(`✓ 预渲染 ${visible.length} 张卡片`);
  console.log(`✓ 输出至 ${OUT_DIR}`);
}

main();
