/**
 * README 平台区块与 data/platforms.json 的同步不变量
 *
 * sync-readme.yml 依赖两条性质：
 * 1. 仓库中的 README 处于已同步状态——跑一遍生成器不产生任何差异。
 *    该断言只在 GitHub Actions 之外执行：生产仓有 sync-readme.yml 兜底修复
 *    （真人在网页改 JSON 无法附带 README 更新，「暂时不同步」是预期输入），
 *    而开发仓（codeup）没有同步机器人，本地必须靠它拦截漏跑的生成器
 * 2. 生成是确定性的——同一数据连跑两次输出一致，
 *    否则审批流水线与同步工作流会互相改写 README 永不停歇
 *
 * 用例会真实执行 scripts/build-readme.js（它会写 README.md），
 * 结束后恢复原始内容，避免断言失败或中断留下脏的工作区。
 */

import { describe, it, assert } from "./harness.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = path.join(ROOT, "README.md");

function regenerateReadme() {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "build-readme.js")],
    { cwd: ROOT, stdio: "pipe" }
  );
}

describe("readme-sync：README 与 platforms.json 的同步不变量", () => {
  it("仓库中的 README 已是同步状态：生成器运行后内容不变（仅本地执行）", () => {
    // GitHub 上由 sync-readme.yml 生成修复提交，不同步正是它的输入
    if (process.env.GITHUB_ACTIONS) return;

    const original = fs.readFileSync(README_PATH, "utf8");
    try {
      regenerateReadme();
      const regenerated = fs.readFileSync(README_PATH, "utf8");
      assert.equal(
        regenerated,
        original,
        "README 与 data/platforms.json 不同步：请先运行 node scripts/build-readme.js 再提交"
      );
    } finally {
      fs.writeFileSync(README_PATH, original);
    }
  });

  it("生成是确定性的：连跑两次输出一致", () => {
    const original = fs.readFileSync(README_PATH, "utf8");
    try {
      regenerateReadme();
      const first = fs.readFileSync(README_PATH, "utf8");
      regenerateReadme();
      const second = fs.readFileSync(README_PATH, "utf8");
      assert.equal(
        second,
        first,
        "build-readme.js 的输出不稳定，README 会被反复改写"
      );
    } finally {
      fs.writeFileSync(README_PATH, original);
    }
  });
});
