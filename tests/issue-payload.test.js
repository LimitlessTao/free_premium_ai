/**
 * Issue 数据标记的编码与解析往返
 *
 * 浏览器生成标记，审批脚本读取标记，两者格式必须严格对应。
 * 此处验证接缝处不会因编码方式或字段命名不一致而断裂。
 */

import { describe, it, assert } from "./harness.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 与 assets/submit.js 中 buildIssueBody 的编码方式保持一致 */
function encodePayload(data) {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function buildIssueBody(data) {
  return [
    "## 投稿内容",
    "",
    `**平台名称**：${data.title}`,
    "",
    "---",
    "",
    `<!-- fpai-submission:v1 ${encodePayload(data)} -->`,
  ].join("\n");
}

/**
 * 在临时副本上运行审批脚本，避免污染仓库数据。
 * 返回 { code, stdout, stderr }。
 */
function runApprove(issueBody) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpai-approve-"));
  fs.cpSync(path.join(ROOT, "scripts"), path.join(workDir, "scripts"), {
    recursive: true,
  });
  fs.cpSync(path.join(ROOT, "data"), path.join(workDir, "data"), {
    recursive: true,
  });

  try {
    const stdout = execFileSync("node", ["scripts/approve.js"], {
      cwd: workDir,
      env: { ...process.env, ISSUE_BODY: issueBody, GITHUB_OUTPUT: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const config = JSON.parse(
      fs.readFileSync(path.join(workDir, "data/platforms.json"), "utf8")
    );
    return { code: 0, stdout, config };
  } catch (err) {
    return { code: err.status, stderr: (err.stderr || "").trim() };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

describe("正常投稿入库", () => {
  const submission = {
    title: "往返测试平台",
    url: "https://roundtrip.example.com/register?aff=xyz",
    note: "注册送 20 美元",
    description: "注册即送 20 美元额度，需邮箱验证。",
    free_premium_model: ["gpt-5.6", "claude-opus-5"],
    poster_githubname: "tester",
  };

  it("标记可被正确解析并写入", () => {
    const result = runApprove(buildIssueBody(submission));
    assert.equal(result.code, 0, result.stderr);

    const entry = result.config.platforms.at(-1);
    assert.equal(entry.title, submission.title);
    assert.equal(entry.url, submission.url);
    assert.equal(entry.note, submission.note);
    assert.equal(entry.poster_githubname, "tester");
  });

  it("id 在已有条目之后递增", () => {
    const result = runApprove(buildIssueBody(submission));
    const platforms = result.config.platforms;
    const maxBefore = Math.max(...platforms.slice(0, -1).map((p) => p.id));
    assert.equal(platforms.at(-1).id, maxBefore + 1);
  });

  it("状态与日期由系统补全", () => {
    const result = runApprove(buildIssueBody(submission));
    const entry = result.config.platforms.at(-1);
    assert.equal(entry.status_bool, true);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entry.updatetime));
  });
});

describe("内容含特殊字符", () => {
  it("Markdown 与反引号不破坏解析", () => {
    const result = runApprove(
      buildIssueBody({
        title: "含 `反引号` 的平台",
        url: "https://backtick.example.com",
        note: "**加粗** 与 <!-- 注释 -->",
        description: "```js\nconsole.log(1)\n```",
        free_premium_model: ["glm5.2"],
        poster_githubname: "",
      })
    );

    assert.equal(result.code, 0, result.stderr);
    const entry = result.config.platforms.at(-1);
    assert.includes(entry.title, "反引号");
    assert.includes(entry.description, "console.log");
  });

  it("换行与中文标点被正确保留", () => {
    const result = runApprove(
      buildIssueBody({
        title: "多行说明平台",
        url: "https://multiline.example.com",
        note: "简短",
        description: "第一段。\n\n第二段，含逗号、顿号。",
        free_premium_model: ["glm5.2"],
        poster_githubname: "",
      })
    );

    assert.equal(result.code, 0, result.stderr);
    assert.includes(result.config.platforms.at(-1).description, "第二段");
  });

  it("正文含多个数据标记时直接拒绝", () => {
    // 投稿文本中含 HTML 注释时会形成第二个形似标记；
    // 在两个标记间二选一没有意义，且可能让攻击内容抢占解析结果，
    // 因此宁可拒绝让管理员人工核对，也不能猜
    const real = {
      title: "真实平台",
      url: "https://real.example.com",
      note: "真实描述",
      free_premium_model: ["glm5.2"],
      poster_githubname: "",
    };
    const fake = encodePayload({
      title: "伪造平台",
      url: "https://evil.example.com",
      note: "伪造",
      free_premium_model: ["x"],
    });

    // 假标记在用户可控文本之前出现的情形，必须同样被拒绝
    const bodyWithFakeFirst = `<!-- fpai-submission:v1 ${fake} -->\n${buildIssueBody(real)}`;
    assert.equal(runApprove(bodyWithFakeFirst).code, 1);

    const bodyWithFakeLast = `${buildIssueBody(real)}\n\n<!-- fpai-submission:v1 ${fake} -->`;
    const result = runApprove(bodyWithFakeLast);
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "多个");
    assert.includes(result.stderr, "篡改");
  });
});

describe("站点生成的正文可入库", () => {
  // 从浏览器源码提取真实的 buildIssueBody，验证「浏览器生成 → 审批入库」整条接缝；
  // 复制一份实现的做法会随时间与真实代码脱节
  const source = fs.readFileSync(path.join(ROOT, "assets/submit.js"), "utf8");
  const extracted = /function buildIssueBody\(data\)\s*\{([\s\S]*?)\n  \}/m.exec(
    source
  );
  if (!extracted) throw new Error("submit.js 中找不到 buildIssueBody");
  const buildBody = new Function("data", extracted[1]);

  it("浏览器生成的正文可被审批脚本解析入库", () => {
    const result = runApprove(
      buildBody({
        title: "浏览器生成测试",
        url: "https://browser-gen.example.com",
        note: "注册送额度",
        description: "详细说明。\n\n第二段，含 `反引号`。",
        free_premium_model: ["glm5.2"],
        poster_githubname: "frontend",
        attachments_and_descriptions: "仅管理员可见的说明",
      })
    );

    assert.equal(result.code, 0, result.stderr);
    const entry = result.config.platforms.at(-1);
    assert.equal(entry.title, "浏览器生成测试");
    assert.equal(entry.poster_githubname, "frontend");
    assert.includes(entry.description, "反引号");
  });
});

describe("异常拦截", () => {
  it("缺少标记时终止", () => {
    const result = runApprove("这是一个普通 issue，没有投稿数据");
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "找不到投稿数据标记");
  });

  it("伪协议 URL 被拒", () => {
    const result = runApprove(
      buildIssueBody({
        title: "恶意",
        url: "javascript:alert(document.cookie)",
        note: "x",
        free_premium_model: ["a"],
      })
    );
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "HTTPS");
  });

  it("HTTP 明文链接被拒", () => {
    const result = runApprove(
      buildIssueBody({
        title: "明文",
        url: "http://insecure.example.com",
        note: "x",
        free_premium_model: ["a"],
      })
    );
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "HTTPS");
  });

  it("缺必填字段时指出字段名", () => {
    const result = runApprove(
      buildIssueBody({ title: "缺字段", url: "https://ok.example.com", note: "x" })
    );
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "free_premium_model");
  });

  it("域名重复时指出已收录条目", () => {
    const result = runApprove(
      buildIssueBody({
        title: "重复投稿",
        url: "https://cloud.siliconflow.cn/i/another",
        note: "x",
        free_premium_model: ["a"],
      })
    );
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "硅基流动");
  });

  it("损坏的 JSON 被拦截", () => {
    const broken = Buffer.from("{不是合法JSON").toString("base64url");
    const result = runApprove(`<!-- fpai-submission:v1 ${broken} -->`);
    assert.equal(result.code, 1);
    assert.includes(result.stderr, "合法 JSON");
  });

  it("手工构造的超限数据被校验拦截", () => {
    // 浏览器校验只是体验优化；任何人都能手工构造带合法标记的 Issue，
    // 审批脚本必须独立拦住超长的标题与格式非法的署名
    const oversized = runApprove(
      buildIssueBody({
        title: "超".repeat(200),
        url: "https://oversize.example.com",
        note: "x",
        free_premium_model: ["a"],
      })
    );
    assert.equal(oversized.code, 1);
    assert.includes(oversized.stderr, "未通过校验");

    const badPoster = runApprove(
      buildIssueBody({
        title: "署名攻击",
        url: "https://poster.example.com",
        note: "x",
        free_premium_model: ["a"],
        poster_githubname: "<script>alert(1)</script>",
      })
    );
    assert.equal(badPoster.code, 1);
    assert.includes(badPoster.stderr, "未通过校验");
  });

  it("入库失败时数据文件保持原样", () => {

    const before = fs.readFileSync(path.join(ROOT, "data/platforms.json"), "utf8");
    runApprove("没有标记的内容");
    const after = fs.readFileSync(path.join(ROOT, "data/platforms.json"), "utf8");
    assert.equal(before, after, "失败不应修改仓库数据");
  });
});
