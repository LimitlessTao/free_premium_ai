#!/usr/bin/env node
/**
 * 审批入库：解析 Issue 中的投稿数据并写入 platforms.json
 *
 * 由 .github/workflows/approve.yml 在权限校验通过后调用。
 * 本脚本假定调用方已验证审批者身份，自身只负责数据正确性。
 *
 * 输入：环境变量 ISSUE_BODY
 * 输出：写入 data/platforms.json；向 stdout 打印结果，向 GITHUB_OUTPUT 写入摘要
 */

const fs = require("fs");
const {
  readConfig,
  writeConfig,
  nextId,
  findByDomain,
  toEntry,
} = require("./platform-data");
const { validateSubmission } = require("./validate");

/** Issue 正文中的机器可读数据标记，带版本号以便日后演进格式 */
const DATA_PATTERN = /<!--\s*fpai-submission:v1\s+([A-Za-z0-9_-]+)\s*-->/;

const REQUIRED_FIELDS = ["title", "url", "note", "free_premium_model"];

/**
 * 从 Issue 正文提取投稿数据。
 * 使用 Base64URL 编码的 JSON 而非解析可读文本——投稿内容含 Markdown、
 * 反引号或换行时，文本解析会失败或被恶意构造绕过。
 */
function extractSubmission(issueBody) {
  // 标记必须恰好一个：投稿文本含 HTML 注释时可能出现第二个形似标记，
  // 若按首个解析，攻击内容会抢在系统追加的真实标记之前被采纳
  const markers = (issueBody || "").match(
    new RegExp(DATA_PATTERN.source, "g")
  );
  if (!markers || markers.length === 0) {
    throw new Error("Issue 正文中找不到投稿数据标记，可能不是通过网站提交的投稿");
  }
  if (markers.length > 1) {
    throw new Error("Issue 正文包含多个投稿数据标记，正文可能被篡改");
  }

  const match = DATA_PATTERN.exec(markers[0]);

  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64url").toString("utf8");
  } catch (err) {
    throw new Error(`投稿数据标记无法解码：${err.message}`);
  }

  let submission;
  try {
    submission = JSON.parse(decoded);
  } catch (err) {
    throw new Error(`投稿数据不是合法 JSON：${err.message}`);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !submission[field]);
  if (missing.length) {
    throw new Error(`投稿数据缺少必填字段：${missing.join("、")}`);
  }

  // 注册链接涉及账号凭据，且 url 会直接进入页面 href，仅允许 HTTPS
  let protocol;
  try {
    protocol = new URL(String(submission.url)).protocol;
  } catch {
    throw new Error(`注册链接不是合法 URL：${submission.url}`);
  }
  if (protocol !== "https:") {
    throw new Error(`注册链接必须是 HTTPS，当前为 ${submission.url}`);
  }

  // 标记可由任何人手工构造，长度上限、署名格式等只有这里兜底
  const { error } = validateSubmission(submission);
  if (error) {
    throw new Error(`投稿数据未通过校验：${error}`);
  }

  return submission;
}

/** 供 workflow 后续步骤读取的输出，同时用于生成 Issue 回复 */
function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  // 多行值需用分隔符包裹，否则含换行的内容会破坏输出文件格式
  const delimiter = `EOF_${key}_${Date.now()}`;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${key}<<${delimiter}\n${value}\n${delimiter}\n`
  );
}

function main() {
  const submission = extractSubmission(process.env.ISSUE_BODY);
  const config = readConfig();

  // 从最新 main 再查一次重复：投稿到审批之间可能已有人提交同一平台
  const duplicate = findByDomain(config.platforms, submission.url);
  if (duplicate) {
    throw new Error(
      `该域名已收录为「${duplicate.title}」（id ${duplicate.id}）。` +
        `如需更新失效信息，请直接修改 data/platforms.json`
    );
  }

  const entry = toEntry(submission, nextId(config.platforms));
  config.platforms.push(entry);
  writeConfig(config);

  console.log(`✓ 已入库 #${entry.id} ${entry.title}`);
  setOutput("platform_id", String(entry.id));
  setOutput("platform_title", entry.title);
  setOutput(
    "summary",
    [
      `- 编号：${entry.id}`,
      `- 平台：${entry.title}`,
      `- 链接：${entry.url}`,
      `- 模型：${entry.free_premium_model.join("、")}`,
      `- 收录日期：${entry.updatetime}`,
    ].join("\n")
  );
}

try {
  main();
} catch (err) {
  console.error(err.message);
  setOutput("error", err.message);
  process.exit(1);
}
