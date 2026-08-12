/**
 * 投稿数据校验与规范化
 */

import { describe, it, assert } from "./harness.js";
import { createRequire } from "node:module";

// scripts 是 CommonJS（供 Actions 直接 require），测试统一走 createRequire 引入
const { validateSubmission, constants } = createRequire(import.meta.url)(
  "../scripts/validate.js"
);

/** 合法投稿的最小字段集，各用例在此基础上覆盖单个字段 */
function baseInput(overrides = {}) {
  return {
    title: "测试平台",
    url: "https://example.com/register?aff=abc",
    note: "注册送 10 美元",
    free_premium_model: "GPT-5.6",
    ...overrides,
  };
}

describe("必填字段", () => {
  it("完整输入通过校验", () => {
    const { data, error } = validateSubmission(baseInput());
    assert.notOk(error);
    assert.equal(data.title, "测试平台");
  });

  it("缺平台名称时报错", () => {
    const { error } = validateSubmission(baseInput({ title: "" }));
    assert.includes(error, "平台名称");
  });

  it("缺注册链接时报错", () => {
    const { error } = validateSubmission(baseInput({ url: "" }));
    assert.includes(error, "注册链接");
  });

  it("缺简短描述时报错", () => {
    const { error } = validateSubmission(baseInput({ note: "" }));
    assert.includes(error, "简短描述");
  });

  it("缺模型时报错", () => {
    const { error } = validateSubmission(baseInput({ free_premium_model: "" }));
    assert.includes(error, "模型");
  });

  it("仅含分隔符的模型输入视为空", () => {
    const { error } = validateSubmission(baseInput({ free_premium_model: "、，, " }));
    assert.includes(error, "模型");
  });
});

describe("URL 协议限制", () => {
  it("接受 HTTPS", () => {
    const { error } = validateSubmission(baseInput({ url: "https://ok.example.com" }));
    assert.notOk(error);
  });

  it("拒绝 HTTP 明文", () => {
    const { error } = validateSubmission(baseInput({ url: "http://insecure.com" }));
    assert.includes(error, "https://");
  });

  it("拒绝 javascript 伪协议", () => {
    const { error } = validateSubmission(
      baseInput({ url: "javascript:alert(document.cookie)" })
    );
    assert.includes(error, "https://");
  });

  it("拒绝 data 伪协议", () => {
    const { error } = validateSubmission(
      baseInput({ url: "data:text/html,<script>alert(1)</script>" })
    );
    assert.includes(error, "https://");
  });

  it("拒绝格式错误的链接", () => {
    const { error } = validateSubmission(baseInput({ url: "不是链接" }));
    assert.includes(error, "格式");
  });
});

describe("模型名归一化", () => {
  it("转小写并将空格转为连字符", () => {
    const { data } = validateSubmission(
      baseInput({ free_premium_model: "Claude Opus 5" })
    );
    assert.deepEqual(data.free_premium_model, ["claude-opus-5"]);
  });

  it("支持英文逗号、中文逗号、顿号与换行混用", () => {
    const { data } = validateSubmission(
      baseInput({ free_premium_model: "a, b，c、d\ne" })
    );
    assert.deepEqual(data.free_premium_model, ["a", "b", "c", "d", "e"]);
  });

  it("归一化后重复项被去除", () => {
    const { data } = validateSubmission(
      baseInput({ free_premium_model: "GPT-5.6, gpt-5.6, GPT-5.6" })
    );
    assert.deepEqual(data.free_premium_model, ["gpt-5.6"]);
  });

  it("数量上限为 8 个", () => {
    const many = Array.from({ length: 20 }, (_, i) => `model-${i}`).join(",");
    const { data } = validateSubmission(baseInput({ free_premium_model: many }));
    assert.equal(data.free_premium_model.length, constants.MAX_MODELS);
  });
});

describe("文本规范化", () => {
  it("统一 Windows 换行符", () => {
    const { data } = validateSubmission(
      baseInput({ description: "第一行\r\n第二行" })
    );
    assert.equal(data.description, "第一行\n第二行");
  });

  it("压缩连续空行", () => {
    const { data } = validateSubmission(
      baseInput({ description: "上\n\n\n\n下" })
    );
    assert.equal(data.description, "上\n\n下");
  });

  it("去除首尾空白", () => {
    const { data } = validateSubmission(baseInput({ title: "  平台名  " }));
    assert.equal(data.title, "平台名");
  });
});

describe("详细描述回退", () => {
  it("留空时使用简短描述", () => {
    const { data } = validateSubmission(
      baseInput({ note: "简短内容", description: "" })
    );
    assert.equal(data.description, "简短内容");
  });

  it("填写时使用自身内容", () => {
    const { data } = validateSubmission(
      baseInput({ note: "简短内容", description: "详细内容" })
    );
    assert.equal(data.description, "详细内容");
  });
});

describe("GitHub 用户名", () => {
  it("留空表示匿名", () => {
    const { data, error } = validateSubmission(
      baseInput({ poster_githubname: "" })
    );
    assert.notOk(error);
    assert.equal(data.poster_githubname, "");
  });

  it("接受合法用户名", () => {
    const { error } = validateSubmission(
      baseInput({ poster_githubname: "swufe-xiongmin" })
    );
    assert.notOk(error);
  });

  it("拒绝含斜杠的输入", () => {
    const { error } = validateSubmission(
      baseInput({ poster_githubname: "user/repo" })
    );
    assert.includes(error, "用户名");
  });

  it("拒绝含空格的输入", () => {
    const { error } = validateSubmission(
      baseInput({ poster_githubname: "user name" })
    );
    assert.includes(error, "用户名");
  });

  it("拒绝以连字符结尾的输入", () => {
    const { error } = validateSubmission(
      baseInput({ poster_githubname: "user-" })
    );
    assert.includes(error, "用户名");
  });
});

describe("长度限制", () => {
  it("平台名称超长时报错", () => {
    const { error } = validateSubmission(
      baseInput({ title: "长".repeat(constants.LIMITS.title + 1) })
    );
    assert.includes(error, "平台名称");
  });

  it("简短描述超长时报错", () => {
    const { error } = validateSubmission(
      baseInput({ note: "长".repeat(constants.LIMITS.note + 1) })
    );
    assert.includes(error, "简短描述");
  });

  it("详细描述超长时报错", () => {
    const { error } = validateSubmission(
      baseInput({ description: "长".repeat(constants.LIMITS.description + 1) })
    );
    assert.includes(error, "详细描述");
  });

  it("投稿说明超长时报错", () => {
    const { error } = validateSubmission(
      baseInput({
        attachments_and_descriptions: "长".repeat(
          constants.LIMITS.attachments_and_descriptions + 1
        ),
      })
    );
    assert.includes(error, "投稿说明");
  });
});

describe("非法输入类型", () => {
  it("字段为 null 时按空处理", () => {
    const { error } = validateSubmission({
      title: null,
      url: null,
      note: null,
      free_premium_model: null,
    });
    assert.includes(error, "平台名称");
  });

  it("空对象不会抛异常", () => {
    const { error } = validateSubmission({});
    assert.ok(error, "应返回错误而非崩溃");
  });
});
