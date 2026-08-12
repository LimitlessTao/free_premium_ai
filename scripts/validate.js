/**
 * 投稿数据校验与规范化
 *
 * 手动提交模式下，本模块是审批入库前的强制校验层：
 * 标记可由任何人手工构造，浏览器校验只是体验优化，
 * 只有这里通过的投稿才允许进入 platforms.json。
 *
 * 归一化规则须与 assets/submit.js 的 validateForm 保持一致，
 * 否则浏览器放行的内容会在审批环节被拦截，表单提示就成了误导。
 * tests/submit.test.js 有对拍保护。
 */

const MAX_MODELS = 8;

/** 长度上限用于挡住明显的滥用输入，正常投稿远达不到 */
const LIMITS = {
  title: 60,
  url: 500,
  note: 200,
  description: 2000,
  poster_githubname: 39,
  attachments_and_descriptions: 2000,
  models_raw: 300,
};

/** GitHub 用户名规则：字母数字与连字符，不能以连字符开头结尾 */
const GITHUB_LOGIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 分隔符同时接受英文逗号、中文逗号、顿号与换行 */
function normalizeModels(raw) {
  const seen = new Set();
  return String(raw ?? "")
    .split(/[,，、\n]/)
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, MAX_MODELS);
}

/**
 * 校验并规范化投稿数据。
 * 返回 { data } 或 { error }，由调用方决定如何响应。
 * 标记中的 free_premium_model 是数组，经 String() 连接后重新归一化，结果不变。
 */
function validateSubmission(input) {
  const title = normalizeText(input.title);
  const url = String(input.url ?? "").trim();
  const note = normalizeText(input.note);
  const description = normalizeText(input.description);
  const poster = normalizeText(input.poster_githubname);
  const attachments = normalizeText(input.attachments_and_descriptions);
  const models = normalizeModels(input.free_premium_model);

  if (!title) return { error: "请填写平台名称" };
  if (title.length > LIMITS.title) {
    return { error: `平台名称不能超过 ${LIMITS.title} 个字符` };
  }

  if (!url) return { error: "请填写注册链接" };
  if (url.length > LIMITS.url) {
    return { error: "注册链接过长" };
  }

  // url 会进入页面 href，且注册链接涉及账号凭据，仅允许 HTTPS
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "注册链接格式不正确" };
  }
  if (parsed.protocol !== "https:") {
    return { error: "注册链接必须以 https:// 开头" };
  }

  if (!note) return { error: "请填写简短描述" };
  if (note.length > LIMITS.note) {
    return { error: `简短描述不能超过 ${LIMITS.note} 个字符` };
  }

  if (description.length > LIMITS.description) {
    return { error: `详细描述不能超过 ${LIMITS.description} 个字符` };
  }

  if (String(input.free_premium_model ?? "").length > LIMITS.models_raw) {
    return { error: "模型列表过长" };
  }
  if (!models.length) return { error: "请填写至少一个免费高级模型" };

  if (poster && !GITHUB_LOGIN_PATTERN.test(poster)) {
    return { error: "GitHub 用户名格式不正确" };
  }

  if (attachments.length > LIMITS.attachments_and_descriptions) {
    return { error: `投稿说明不能超过 ${LIMITS.attachments_and_descriptions} 个字符` };
  }

  return {
    data: {
      title,
      url,
      note,
      // 留空时回退到简短描述，与入库脚本行为一致
      description: description || note,
      free_premium_model: models,
      poster_githubname: poster,
      attachments_and_descriptions: attachments,
    },
  };
}

module.exports = {
  validateSubmission,
  constants: { MAX_MODELS, LIMITS },
};
