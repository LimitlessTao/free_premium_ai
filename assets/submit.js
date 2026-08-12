/**
 * 投稿弹窗：生成预填的 GitHub Issue 链接（手动提交模式，正式架构）
 *
 * 表单内容在浏览器内校验并编码为 Issue URL，投稿者在 GitHub 页面
 * 确认后自行提交。投稿者身份由 GitHub 账号天然保证，
 * 因此站点不需要任何服务端：无登录、无人机验证、无密钥。
 * 审批流水线通过正文中的机器数据标记识别有效投稿，
 * 见 .github/workflows/approve.yml 与 scripts/approve.js。
 *
 * 前端的校验与反馈只是体验优化；审批入库脚本（scripts/validate.js）
 * 会重新全量校验标记内容，恶意修改正文只会让标记失效、被静默拒绝。
 */

(function () {
  /** 生成 URL 的长度上限：GitHub 对超长 URL 会直接拒绝，超出时引导精简 */
  const MAX_ISSUE_URL_LENGTH = 7500;

  /**
   * 与 scripts/validate.js 保持一致：两处分别把关生成与入库，
   * 偏差会让浏览器生成的内容在审批环节被拦截，对拍测试保护两侧同步。
   */
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
  const GITHUB_LOGIN_PATTERN =
    /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

  const config = readSiteConfig();

  function readSiteConfig() {
    const node = document.getElementById("site-config");
    try {
      return JSON.parse(node.textContent) || {};
    } catch {
      return {};
    }
  }

  const el = {
    modal: document.getElementById("submit-modal"),
    form: document.getElementById("submit-form"),
    submitBtn: document.getElementById("submit-button"),
    alert: document.getElementById("submit-alert"),
    urlInput: document.getElementById("f-url"),
    urlFeedback: document.getElementById("f-url-feedback"),
    modelsInput: document.getElementById("f-models"),
    modelsPreview: document.getElementById("f-models-preview"),
    posterInput: document.getElementById("f-poster"),
    posterFeedback: document.getElementById("f-poster-feedback"),
  };

  /* ---------- 提示 ---------- */

  function showAlert(kind, message, extraHtml) {
    el.alert.className = `submit-alert is-${kind}`;
    el.alert.innerHTML = extraHtml ? `${message}${extraHtml}` : message;
    el.alert.hidden = false;
  }

  function clearAlert() {
    el.alert.hidden = true;
    el.alert.innerHTML = "";
  }

  function escapeText(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* ---------- 校验与归一化 ---------- */

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** 分隔符与归一化规则须与入库脚本一致，否则预览会误导投稿人 */
  function parseModels(raw) {
    const seen = new Set();
    return String(raw ?? "")
      .split(/[,，、\n]/)
      .map((item) => item.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter((item) => item && !seen.has(item) && seen.add(item))
      .slice(0, 8);
  }

  /**
   * 校验并归一化整个表单。返回 { data } 或 { error }，
   * 产生的 data 会被原样编码进 Issue 标记，因此规则必须与
   * scripts/validate.js 逐字段一致。
   */
  function validateForm(input) {
    const title = normalizeText(input.title);
    const url = String(input.url ?? "").trim();
    const note = normalizeText(input.note);
    const description = normalizeText(input.description);
    const poster = normalizeText(input.poster_githubname);
    const attachments = normalizeText(input.attachments_and_descriptions);
    const models = parseModels(input.free_premium_model);

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
      return {
        error: `投稿说明不能超过 ${LIMITS.attachments_and_descriptions} 个字符`,
      };
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

  /**
   * 构造 Issue 正文：人读层供管理员审核，机器层是 Base64URL 编码的 JSON 标记，
   * 供审批脚本无歧义解析——投稿文字含 Markdown 或反引号也不会破坏格式。
   * 该函数自包含（内联编码实现），供测试直接提取求值。
   */
  function buildIssueBody(data) {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        title: data.title,
        url: data.url,
        note: data.note,
        description: data.description,
        free_premium_model: data.free_premium_model,
        poster_githubname: data.poster_githubname,
      })
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const payload = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return [
      "## 投稿内容",
      "",
      `**平台名称**：${data.title}`,
      "",
      `**注册链接**：${data.url}`,
      "",
      `**免费高级模型**：${data.free_premium_model.join("、")}`,
      "",
      "**简短描述**：",
      "",
      data.note,
      "",
      "**详细描述**：",
      "",
      data.description,
      "",
      `**署名**：${data.poster_githubname || "（匿名）"}`,
      "",
      "## 投稿说明与附件",
      "",
      data.attachments_and_descriptions || "（未填写）",
      "",
      "---",
      "",
      "如需修正请直接修改上方文字后再提交；请勿改动下方的机器数据标记，否则投稿无法被自动入库。",
      "管理员审核：通过请评论 `/approve`，拒绝请评论 `/reject 原因`。",
      "",
      `<!-- fpai-submission:v1 ${payload} -->`,
    ].join("\n");
  }

  /* ---------- 字段即时反馈 ---------- */

  function setFeedback(node, kind, html) {
    node.className = kind ? `field-feedback is-${kind}` : "field-feedback";
    node.innerHTML = html || "";
  }

  function checkUrl() {
    const value = el.urlInput.value.trim();
    if (!value) return setFeedback(el.urlFeedback, "", "");

    if (!/^https:\/\/.+/i.test(value)) {
      return setFeedback(
        el.urlFeedback,
        "error",
        "请填写以 https:// 开头的完整链接"
      );
    }

    const duplicate = window.SubmitHooks?.findDuplicate?.(value);
    if (duplicate) {
      return setFeedback(
        el.urlFeedback,
        "warn",
        `该平台可能已收录：<strong>${escapeText(
          duplicate.title
        )}</strong>。若是更新失效信息请继续提交`
      );
    }

    setFeedback(el.urlFeedback, "", "");
  }

  function previewModels() {
    const models = parseModels(el.modelsInput.value);
    setFeedback(
      el.modelsPreview,
      "",
      models.length
        ? `将保存为 ${models
            .map((m) => `<code>${escapeText(m)}</code>`)
            .join("、")}`
        : ""
    );
  }

  function checkPoster() {
    const value = el.posterInput.value.trim();
    if (!value) {
      return setFeedback(el.posterFeedback, "", "留空则以匿名身份投稿");
    }
    if (!GITHUB_LOGIN_PATTERN.test(value)) {
      return setFeedback(el.posterFeedback, "error", "GitHub 用户名格式不正确");
    }
    setFeedback(el.posterFeedback, "", "");
  }

  /* ---------- 提交 ---------- */

  function collectForm() {
    return {
      title: document.getElementById("f-title").value,
      url: el.urlInput.value,
      note: document.getElementById("f-note").value,
      description: document.getElementById("f-description").value,
      free_premium_model: el.modelsInput.value,
      poster_githubname: el.posterInput.value,
      attachments_and_descriptions: document.getElementById("f-extra").value,
    };
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearAlert();

    if (!config.repoUrl) {
      showAlert("error", "投稿通道尚未配置，暂时无法使用。");
      return;
    }

    const { data, error } = validateForm(collectForm());
    if (error) {
      showAlert("warn", escapeText(error));
      return;
    }

    const titleParam = encodeURIComponent(`[投稿] ${data.title}`);
    const bodyParam = encodeURIComponent(buildIssueBody(data));
    const issueUrl = `${config.repoUrl.replace(
      /\/$/,
      ""
    )}/issues/new?title=${titleParam}&body=${bodyParam}`;

    if (issueUrl.length > MAX_ISSUE_URL_LENGTH) {
      showAlert(
        "warn",
        `内容生成的提交链接过长（${issueUrl.length} 字符，上限 ${MAX_ISSUE_URL_LENGTH}），请精简详细描述或投稿说明后重试。`
      );
      return;
    }

    window.open(issueUrl, "_blank", "noopener");
    showAlert(
      "success",
      "已在 GitHub 打开投稿页面，请检查内容后点击 <strong>Submit new issue</strong> 完成提交；管理员审核通过即收录。"
    );
  }

  /* ---------- 初始化 ---------- */

  function init() {
    el.form.addEventListener("submit", handleSubmit);
    el.urlInput.addEventListener("blur", checkUrl);
    el.modelsInput.addEventListener("input", previewModels);
    el.posterInput.addEventListener("blur", checkPoster);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
