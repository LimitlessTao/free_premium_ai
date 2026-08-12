/**
 * 构建产物的站点配置注入
 *
 * 防的是这类坑：模板定位用的注释标记保留在构建产物里，
 * 浏览器读 script 的 textContent 时混入注释，JSON.parse 失败后被
 * try/catch 静默吞掉——页面看起来正常，但 repoUrl 等运行配置实际为空，
 * 投稿、反馈等依赖 repoUrl 的功能全部静默失效。
 *
 * 同时锁定 REPO_URL / SITE_URL 环境变量对数据文件的覆盖行为，
 * 这是测试部署指向测试仓库的唯一机制。
 */

import { describe, it, assert } from "./harness.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 以测试部署参数运行真实构建，返回产物的 index.html 内容 */
function buildDist(env) {
  execFileSync("node", [path.join(ROOT, "build.js")], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return fs.readFileSync(path.join(ROOT, "dist/index.html"), "utf8");
}

const OVERRIDE_REPO = "https://github.com/owner/test-repo";
const OVERRIDE_SITE = "https://preview.example-pages.dev";
const html = buildDist({
  REPO_URL: OVERRIDE_REPO,
  SITE_URL: OVERRIDE_SITE,
});

const dataConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/platforms.json"), "utf8")
);

function extractSiteConfig(html) {
  const match = /<script id="site-config"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "产物中应有 site-config script");
  assert.ok(
    !match[1].includes("<!--"),
    "产物 script 内容不应残留定位注释，否则浏览器 JSON.parse 会失败"
  );
  return JSON.parse(match[1]);
}

describe("站点配置注入", () => {
  it("script 内容是可直接解析的纯 JSON", () => {
    const config = extractSiteConfig(html);
    assert.equal(typeof config, "object");
  });

  it("REPO_URL 环境变量覆盖数据文件", () => {
    const config = extractSiteConfig(html);
    assert.equal(config.repoUrl, OVERRIDE_REPO);
  });

  it("品牌区与页脚仓库链接同样被覆盖", () => {
    // 平台数据里的 GitHub 链接（如投稿人主页）属于内容，不应被覆盖；
    // 这里只断言站点级仓库引用：品牌区链接与页脚「反馈失效」链接
    assert.includes(html, `class="repo-inline" href="${OVERRIDE_REPO}"`);
    assert.includes(html, `href="${OVERRIDE_REPO}/issues"`);
    assert.ok(
      !html.includes(`href="${dataConfig.repo_url}"`),
      "覆盖生效时，数据文件中的仓库地址不应再作为链接出现"
    );
  });

  it("SITE_URL 环境变量进入 OG 标签", () => {
    assert.includes(html, `content="${OVERRIDE_SITE}"`);
  });
});

describe("无覆盖时回退到数据文件", () => {
  const defaultHtml = buildDist({ REPO_URL: "", SITE_URL: "" });

  it("repoUrl 回退为数据文件的 repo_url", () => {
    const config = extractSiteConfig(defaultHtml);
    assert.equal(config.repoUrl, dataConfig.repo_url);
  });
});
