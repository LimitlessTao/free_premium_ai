/**
 * 平台数据的读写与规范化 —— 构建脚本与审批脚本共用
 *
 * 所有写入 platforms.json 的操作都必须经过本模块，
 * 以保证字段顺序、归一化规则和格式在各处一致。
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "platforms.json");

/** 投稿人可填字段之外的系统字段，由入库流程自动补全 */
const MAX_MODELS = 8;

function readConfig(dataPath = DATA_PATH) {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

/** 统一以两空格缩进并保留结尾换行，避免不同工具写出的 diff 噪音 */
function writeConfig(config, dataPath = DATA_PATH) {
  fs.writeFileSync(dataPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * 模型名归一化：转小写、空格转连字符。
 * 分隔符同时接受英文逗号、中文逗号、顿号与换行——中文投稿人常用顿号。
 */
function normalizeModels(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,，、\n]/);
  const seen = new Set();
  return list
    .map((item) => String(item).trim().toLowerCase().replace(/\s+/g, "-"))
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, MAX_MODELS);
}

/** 统一换行符并压缩连续空行，避免粘贴文本破坏排版 */
function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 入库时刻才分配 id，避免并发投稿撞号与被拒投稿占用号段 */
function nextId(platforms) {
  return platforms.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

/** 按仓库所在时区生成日期，避免 Action 运行在 UTC 导致日期提前一天 */
function today(timeZone = "Asia/Shanghai") {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

function getDomain(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 按域名而非标题查重：AFF 参数不同但域名相同即为同一平台 */
function findByDomain(platforms, url) {
  const domain = getDomain(url);
  if (!domain) return null;
  return platforms.find((item) => getDomain(item.url) === domain) || null;
}

/**
 * 把投稿数据转为入库条目。
 * 字段顺序固定，系统字段由此处统一补全，投稿人无法覆盖。
 */
function toEntry(submission, id, timeZone) {
  return {
    id,
    title: normalizeText(submission.title),
    url: String(submission.url).trim(),
    note: normalizeText(submission.note),
    description: normalizeText(submission.description) || normalizeText(submission.note),
    free_premium_model: normalizeModels(submission.free_premium_model),
    status_bool: true,
    poster_githubname: normalizeText(submission.poster_githubname),
    updatetime: today(timeZone),
  };
}

module.exports = {
  DATA_PATH,
  MAX_MODELS,
  readConfig,
  writeConfig,
  normalizeModels,
  normalizeText,
  nextId,
  today,
  getDomain,
  findByDomain,
  toEntry,
};
