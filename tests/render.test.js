/**
 * 渲染安全：HTML 转义与 URL 白名单
 *
 * 这两处是页面唯一接收投稿内容的位置，任何疏漏都会变成 XSS。
 */

import { describe, it, assert } from "./harness.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Render = require("../assets/render.js");

describe("HTML 转义", () => {
  it("转义尖括号", () => {
    assert.equal(
      Render.escapeHtml("<script>alert(1)</script>"),
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("转义引号，防止属��逃逸", () => {
    assert.equal(
      Render.escapeHtml('" onerror="alert(1)'),
      "&quot; onerror=&quot;alert(1)"
    );
  });

  it("转义单引号", () => {
    assert.includes(Render.escapeHtml("it's"), "&#39;");
  });

  it("转义与号，避免二次解码", () => {
    assert.equal(Render.escapeHtml("&lt;"), "&amp;lt;");
  });

  it("空值不抛异常", () => {
    assert.equal(Render.escapeHtml(null), "");
    assert.equal(Render.escapeHtml(undefined), "");
  });
});

describe("URL 白名单", () => {
  it("接受 HTTPS", () => {
    assert.ok(Render.isSafeUrl("https://example.com"));
  });

  it("拒绝 HTTP", () => {
    assert.notOk(Render.isSafeUrl("http://example.com"));
  });

  it("拒绝 javascript 伪协议", () => {
    assert.notOk(Render.isSafeUrl("javascript:alert(1)"));
  });

  it("拒绝大小写混写的伪协议", () => {
    assert.notOk(Render.isSafeUrl("JaVaScRiPt:alert(1)"));
  });

  it("拒绝 data 协议", () => {
    assert.notOk(Render.isSafeUrl("data:text/html,<script>alert(1)</script>"));
  });

  it("拒绝 vbscript 协议", () => {
    assert.notOk(Render.isSafeUrl("vbscript:msgbox(1)"));
  });

  it("拒绝非法字符串", () => {
    assert.notOk(Render.isSafeUrl("不是链接"));
    assert.notOk(Render.isSafeUrl(""));
  });

  it("不安全链接降级为无跳转", () => {
    assert.equal(Render.safeHref("javascript:alert(1)"), "#");
  });

  it("安全链接保持原样并转义", () => {
    assert.equal(
      Render.safeHref("https://example.com/?a=1&b=2"),
      "https://example.com/?a=1&amp;b=2"
    );
  });
});

describe("卡片渲染", () => {
  const item = {
    id: 1,
    title: "测试平台",
    url: "https://example.com/register",
    note: "注册送 10 美元",
    description: "详细说明",
    free_premium_model: ["gpt-5.6", "glm5.2"],
    status_bool: true,
    poster_githubname: "someone",
    updatetime: "2026-08-11",
  };

  it("恶意标题被转义而非执行", () => {
    const html = Render.renderCard({ ...item, title: "<img src=x onerror=alert(1)>" });
    assert.notOk(html.includes("<img src=x"), "标签不应原样输出");
    assert.includes(html, "&lt;img");
  });

  it("恶意描述被转义", () => {
    const html = Render.renderCard({ ...item, note: "<script>alert(1)</script>" });
    assert.notOk(html.includes("<script>alert(1)</script>"));
  });

  it("伪协议链接不会进入 href", () => {
    const html = Render.renderCard({ ...item, url: "javascript:alert(1)" });
    assert.notOk(html.includes('href="javascript:'));
  });

  it("模型标签带说明文字", () => {
    const html = Render.renderCard(item);
    assert.includes(html, "免费高级模型");
  });

  it("超过 4 个模型时折叠为 +N", () => {
    const html = Render.renderCard({
      ...item,
      free_premium_model: ["a", "b", "c", "d", "e", "f"],
    });
    assert.includes(html, "+2");
  });

  it("填写署名时生成 GitHub 链接", () => {
    const html = Render.renderCard(item);
    assert.includes(html, "https://github.com/someone");
  });

  it("未填署名时不显示投稿人", () => {
    const html = Render.renderCard({ ...item, poster_githubname: "" });
    assert.notOk(html.includes("投稿人"));
  });

  it("署名中的特殊字符被编码", () => {
    const html = Render.renderCard({ ...item, poster_githubname: '"><script>' });
    assert.notOk(html.includes("<script>"));
  });
});

describe("列表过滤与排序", () => {
  const platforms = [
    { id: 3, title: "C", status_bool: true },
    { id: 1, title: "A", status_bool: true },
    { id: 2, title: "B", status_bool: false },
  ];

  it("失效条目不展示", () => {
    const visible = Render.selectVisible(platforms);
    assert.equal(visible.length, 2);
    assert.notOk(visible.some((item) => item.title === "B"));
  });

  it("按 id 升序排列", () => {
    const visible = Render.selectVisible(platforms);
    assert.deepEqual(visible.map((item) => item.id), [1, 3]);
  });

  it("空列表返回空数组", () => {
    assert.deepEqual(Render.selectVisible([]), []);
    assert.deepEqual(Render.selectVisible(undefined), []);
  });
});

describe("首字母色块", () => {
  it("同名平台恒定同色", () => {
    const first = Render.renderAvatar("硅基流动");
    const second = Render.renderAvatar("硅基流动");
    assert.equal(first, second);
  });

  it("中文取首字", () => {
    assert.includes(Render.renderAvatar("硅基流动"), ">硅<");
  });

  it("英文取首字母", () => {
    assert.includes(Render.renderAvatar("Modal"), ">M<");
  });

  it("空标题不抛异常", () => {
    assert.includes(Render.renderAvatar(""), ">?<");
  });
});

describe("文本渲染", () => {
  it("统一换行符", () => {
    assert.equal(Render.renderText("a\r\nb"), "a\nb");
  });

  it("压缩连续空行", () => {
    assert.equal(Render.renderText("a\n\n\n\nb"), "a\n\nb");
  });

  it("不将 URL 转为链接", () => {
    const output = Render.renderText("详见 https://example.com");
    assert.notOk(output.includes("<a "), "note 与 description 应保持纯文本");
  });
});
