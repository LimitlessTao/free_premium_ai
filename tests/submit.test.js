/**
 * 投稿弹窗的纯逻辑（手动提交模式）
 *
 * DOM 交互无法在 Node 中验证，此处覆盖可独立测试的部分：
 * 浏览器一侧的校验与归一化会原样编码进 Issue 标记并被审批脚本入库，
 * 因此必须与 scripts/validate.js 逐字段一致，否则
 * 浏览器提示「可提交」的内容会在审批环节被拦截，表单提示就成了误导。
 */

import { describe, it, assert } from "./harness.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

const source = fs.readFileSync(path.join(ROOT, "assets/submit.js"), "utf8");

/**
 * 从源码中提取函数体求值。
 * 比复制一份实现更可靠——复制品会随时间与真实代码脱节。
 */
function extractFunction(name) {
  const pattern = new RegExp(
    `function ${name}\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n  \\}`,
    "m"
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`源码中找不到函数 ${name}`);
  return new Function(match[1], match[2]);
}

const parseModels = extractFunction("parseModels");

describe("前端模型名预览", () => {
  it("转小写并将空格转为连字符", () => {
    assert.deepEqual(parseModels("Claude Opus 5"), ["claude-opus-5"]);
  });

  it("支持四种分隔符混用", () => {
    assert.deepEqual(parseModels("a, b，c、d\ne"), ["a", "b", "c", "d", "e"]);
  });

  it("去除归一化后的重复项", () => {
    assert.deepEqual(parseModels("GPT-5.6, gpt-5.6"), ["gpt-5.6"]);
  });

  it("上限 8 个", () => {
    const many = Array.from({ length: 20 }, (_, i) => `m${i}`).join(",");
    assert.equal(parseModels(many).length, 8);
  });

  it("空输入返回空数组", () => {
    assert.deepEqual(parseModels(""), []);
    assert.deepEqual(parseModels("、，, "), []);
  });
});

describe("前后端归一化一致性", () => {
  const data = require("../scripts/platform-data.js");

  const samples = [
    "GPT-5.6、Claude Opus 5",
    "a, b，c、d\ne",
    "GLM5.2, glm5.2, GLM5.2",
    "  空格开头, 结尾空格  ",
    "Kimi K3",
  ];

  it("与入库脚本产出相同结果", () => {
    for (const sample of samples) {
      assert.deepEqual(
        parseModels(sample),
        data.normalizeModels(sample),
        `样本「${sample}」前后端结果不一致`
      );
    }
  });
});

describe("表单校验与审批脚本一致", () => {
  // validateForm 引用模块内的辅助函数与常量，提取时以参数注入，
  // 注入的值也从同一源码中提取，保证测的是真实运行时内容
  const bodyMatch = /function validateForm\(input\)\s*\{([\s\S]*?)\n  \}/m.exec(
    source
  );
  if (!bodyMatch) throw new Error("源码中找不到函数 validateForm");

  // 审批侧的规范实现，与 functions 已删除后的 scripts/validate.js 对拍
  const { validateSubmission } = require("../scripts/validate.js");

  /** 提取模块内的常量声明（对象/正则字面量） */
  function extractConst(name) {
    const match = new RegExp(
      `const ${name}\\s*=\\s*([\\s\\S]*?);\\n`,
      "m"
    ).exec(source);
    if (!match) throw new Error(`源码中找不到常量 ${name}`);
    return new Function(`return (${match[1]});`)();
  }

  const normalizeText = extractFunction("normalizeText");
  const clientLimits = extractConst("LIMITS");
  const clientLoginPattern = extractConst("GITHUB_LOGIN_PATTERN");

  const validateForm = new Function(
    "parseModels",
    "normalizeText",
    "LIMITS",
    "GITHUB_LOGIN_PATTERN",
    "input",
    bodyMatch[1]
  );
  // 按 validateForm 的参数签名构造调用器
  const runFront = (input) =>
    validateForm(
      parseModels,
      normalizeText,
      clientLimits,
      clientLoginPattern,
      input
    );

  it("长度上限常量与审批脚本一致", () => {
    const { constants } = require("../scripts/validate.js");
    assert.deepEqual(
      clientLimits,
      constants.LIMITS,
      "前端 LIMITS 与审批脚本不一致，放宽或收紧都会导致前后表现分裂"
    );
  });

  const validSamples = [
    {
      title: "硅基流动",
      url: "https://cloud.siliconflow.cn/i/abc",
      note: "注册送 14 元余额",
      description: "注册即送，需手机号。",
      free_premium_model: "GLM5.2、Claude Opus 5",
      poster_githubname: "tester",
      attachments_and_descriptions: "",
    },
    {
      // CRLF 与空详细描述：归一化后 description 应回退到 note
      title: "multi-line",
      url: "https://example.com/register?aff=x",
      note: "note\r\n内容",
      description: "",
      free_premium_model: "a, b，c",
      poster_githubname: "",
      attachments_and_descriptions: "已\r\n验证",
    },
    {
      title: "全角字符",
      url: "https://example.com",
      note: "支持中文标点，顿号。",
      description: "第一段。\n\n\n\n第二段。",
      free_premium_model: "Kimi K3",
      poster_githubname: "A-b",
      attachments_and_descriptions: "截图：https://img.example.com/x.png",
    },
  ];

  it("有效样本产出与审批脚本相同的数据", () => {
    for (const sample of validSamples) {
      const front = runFront(sample);
      const back = validateSubmission(sample);
      assert.ok(!front.error, `前端拒绝了样本：${front.error}`);
      assert.ok(!back.error, `审批脚本拒绝了样本：${back.error}`);
      assert.deepEqual(
        front.data,
        back.data,
        `浏览器与审批脚本校验结果不一致（${sample.title}）`
      );
    }
  });

  const invalidSamples = [
    { title: "", url: "https://x.com", note: "n", free_premium_model: "a" },
    { url: "https://x.com", note: "n", free_premium_model: "a" },
    { title: "t", url: "http://insecure.com", note: "n", free_premium_model: "a" },
    { title: "t", url: " javascript:alert(1) ", note: "n", free_premium_model: "a" },
    { title: "t", url: "https://x.com", note: "", free_premium_model: "a" },
    { title: "t", url: "https://x.com", note: "n", free_premium_model: "  " },
    {
      title: "t",
      url: "https://x.com",
      note: "n",
      free_premium_model: "a",
      poster_githubname: "-bad-name",
    },
  ];

  it("无效样本被两侧同时拒绝", () => {
    for (const sample of invalidSamples) {
      const front = runFront(sample);
      const back = validateSubmission(sample);
      assert.ok(front.error, `前端放过了无效样本：${JSON.stringify(sample)}`);
      assert.ok(back.error, `审批脚本放过了无效样本：${JSON.stringify(sample)}`);
    }
  });
});

describe("Issue 正文生成", () => {
  const buildIssueBody = extractFunction("buildIssueBody");

  function markerPayload(html) {
    const match = /<!--\s*fpai-submission:v1\s+([A-Za-z0-9_-]+)\s*-->/g.exec(html);
    assert.ok(match, "正文应恰好包含一个数据标记");
    assert.equal(
      (html.match(/<!--\s*fpai-submission:v1\s+[A-Za-z0-9_-]+\s*-->/g) || [])
        .length,
      1,
      "数据标记应恰好出现一次"
    );
    return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  }

  it("标记可被无歧义解析回原始数据（含中文与换行）", () => {
    const data = {
      title: "往返测试",
      url: "https://example.com",
      note: "注册送 20 美元",
      description: "第一段。\n\n第二段，含 `反引号`。",
      free_premium_model: ["gpt-5.6", "claude-opus-5"],
      poster_githubname: "tester",
      attachments_and_descriptions: "（未填写）",
    };
    const body = buildIssueBody(data);
    const payload = markerPayload(body);
    assert.deepEqual(payload, {
      title: data.title,
      url: data.url,
      note: data.note,
      description: data.description,
      free_premium_model: data.free_premium_model,
      poster_githubname: data.poster_githubname,
    });
  });

  it("人读层包含管理员审核指引且标记位于末尾", () => {
    const data = {
      title: "x",
      url: "https://example.com",
      note: "n",
      description: "d",
      free_premium_model: ["a"],
      poster_githubname: "",
      attachments_and_descriptions: "",
    };
    const body = buildIssueBody(data);
    assert.includes(body, "/approve");
    assert.includes(body, "/reject");
    assert.includes(body, "（匿名）");
    assert.ok(
      body.trimEnd().endsWith("-->"),
      "数据标记应位于正文末尾，避免被投稿文字遮没"
    );
  });
});

describe("源码约定", () => {
  it("生成链接指向仓库 issues/new", () => {
    assert.includes(source, "/issues/new");
  });

  it("链接通过查询参数预填标题与正文", () => {
    assert.includes(source, "title=");
    assert.includes(source, "body=");
  });

  it("正文含机器数据标记", () => {
    assert.includes(source, "fpai-submission:v1");
  });

  it("有 URL 长度保护", () => {
    // GitHub 会拒绝超长 URL，静默截断会导致标记损坏
    assert.includes(source, "MAX_ISSUE_URL_LENGTH");
  });

  it("不再依赖人机验证", () => {
    // 手动模式下提交发生在 GitHub，站点没有任何服务端调用需要抵御自动化
    assert.ok(!/turnstile/i.test(source), "submit.js 不应再引用 turnstile");
  });
});

describe("页面结构", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  it("表单字段默认可用", () => {
    assert.ok(
      !html.includes('<fieldset id="submit-fields" disabled>'),
      "手动模式下表单不应再整体禁用"
    );
  });

  it("提交按钮默认可用且指向 GitHub", () => {
    assert.ok(!html.includes('id="submit-button" disabled'));
    assert.includes(html, "前往 GitHub");
  });

  it("投稿说明含隐私提示", () => {
    assert.includes(html, "请勿填写手机号");
  });

  it("投稿说明标明 Issue 公开", () => {
    assert.includes(html, "公开的");
  });

  it("投稿说明含 GitHub 跳转提示", () => {
    assert.includes(html, "跳转到 GitHub");
  });

  it("不再包含 Turnstile 挂载点", () => {
    assert.ok(!html.includes('id="turnstile-slot"'));
  });

  it("站点配置为 JSON script 而非内联脚本", () => {
    assert.includes(html, 'id="site-config" type="application/json"');
  });
});
