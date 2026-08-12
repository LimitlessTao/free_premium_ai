#!/usr/bin/env node
/**
 * 生成 README 的平台列表区块
 *
 * 只替换 <!-- platforms:start --> 与 <!-- platforms:end --> 之间的内容，
 * 标记之外的项目介绍、收录标准、投稿说明均为手写，不受影响。
 */

const fs = require("fs");
const path = require("path");
const { readConfig } = require("./platform-data");

const README_PATH = path.join(__dirname, "..", "README.md");
const START_MARK = "<!-- platforms:start -->";
const END_MARK = "<!-- platforms:end -->";

/** 沿用仓库原有的四段式条目格式，保持读者的阅读习惯 */
function renderEntry(item) {
  const models = item.free_premium_model.join(" ");
  const lines = [
    `### ${item.title}`,
    "",
    `链接： [${item.title}](${item.url})`,
    "",
    `高级模型: ${models}`,
    "",
    `免费额度与注册说明： ${item.description || item.note}`,
  ];

  if (item.poster_githubname) {
    lines.push(
      "",
      `投稿人： [${item.poster_githubname}](https://github.com/${item.poster_githubname})`
    );
  }

  return lines.join("\n");
}

function renderPlatforms(platforms) {
  // status_bool 为 false 的条目不展示，数据保留在 JSON 中以便恢复
  const visible = platforms
    .filter((item) => item.status_bool)
    .sort((a, b) => a.id - b.id);

  return visible.map(renderEntry).join("\n\n");
}

function main() {
  const config = readConfig();
  const readme = fs.readFileSync(README_PATH, "utf8");

  const startIndex = readme.indexOf(START_MARK);
  const endIndex = readme.indexOf(END_MARK);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    console.error(
      `README 中找不到成对的标记 ${START_MARK} 与 ${END_MARK}，已跳过生成`
    );
    process.exit(1);
  }

  const before = readme.slice(0, startIndex + START_MARK.length);
  const after = readme.slice(endIndex);
  const body = renderPlatforms(config.platforms);

  fs.writeFileSync(README_PATH, `${before}\n\n${body}\n\n${after}`);

  const count = config.platforms.filter((item) => item.status_bool).length;
  console.log(`✓ README 平台列表已更新，${count} 个平台`);
}

main();
