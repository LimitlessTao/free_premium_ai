/**
 * 入库数据处理：id 分配、字段补全、域名查重
 *
 * 这些规则与 scripts/validate.js 相互对应，
 * 前者在投稿时校验，后者在审批入库时最终定型。
 */

import { describe, it, assert } from "./harness.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const data = require("../scripts/platform-data.js");

describe("id 分配", () => {
  it("取当前最大值加一", () => {
    assert.equal(data.nextId([{ id: 1 }, { id: 5 }, { id: 3 }]), 6);
  });

  it("空列表从 1 开始", () => {
    assert.equal(data.nextId([]), 1);
  });

  it("忽略缺失的 id 字段", () => {
    assert.equal(data.nextId([{ id: 2 }, {}]), 3);
  });
});

describe("模型名归一化", () => {
  it("与投稿端规则一致", () => {
    assert.deepEqual(data.normalizeModels("GPT-5.6、Claude Opus 5"), [
      "gpt-5.6",
      "claude-opus-5",
    ]);
  });

  it("接受已是数组的输入", () => {
    assert.deepEqual(data.normalizeModels(["GLM5.2", "GLM5.2"]), ["glm5.2"]);
  });

  it("上限 8 个", () => {
    const many = Array.from({ length: 15 }, (_, i) => `m${i}`);
    assert.equal(data.normalizeModels(many).length, data.MAX_MODELS);
  });
});

describe("域名提取与查重", () => {
  it("去除 www 前缀", () => {
    assert.equal(data.getDomain("https://www.example.com/path"), "example.com");
  });

  it("非法 URL 返回空串", () => {
    assert.equal(data.getDomain("不是链接"), "");
  });

  it("AFF 参数不同但域名相同视为重复", () => {
    const platforms = [
      { id: 1, title: "示例站", url: "https://example.com/register?aff=aaa" },
    ];
    const found = data.findByDomain(platforms, "https://example.com/signup?aff=bbb");
    assert.ok(found);
    assert.equal(found.title, "示例站");
  });

  it("不同域名不算重复", () => {
    const platforms = [{ id: 1, title: "A", url: "https://a.com" }];
    assert.equal(data.findByDomain(platforms, "https://b.com"), null);
  });
});

describe("入库条目构造", () => {
  const submission = {
    title: "  测试平台  ",
    url: "https://test.example.com/register",
    note: "简短描述",
    description: "",
    free_premium_model: "GPT-5.6、GLM5.2",
    poster_githubname: "someone",
  };

  it("字段顺序固定", () => {
    const entry = data.toEntry(submission, 10);
    assert.deepEqual(Object.keys(entry), [
      "id",
      "title",
      "url",
      "note",
      "description",
      "free_premium_model",
      "status_bool",
      "poster_githubname",
      "updatetime",
    ]);
  });

  it("系统字段由入库流程补全", () => {
    const entry = data.toEntry(submission, 10);
    assert.equal(entry.id, 10);
    assert.equal(entry.status_bool, true);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entry.updatetime));
  });

  it("详细描述留空时回退到简短描述", () => {
    const entry = data.toEntry(submission, 1);
    assert.equal(entry.description, "简短描述");
  });

  it("标题首尾空白被去除", () => {
    const entry = data.toEntry(submission, 1);
    assert.equal(entry.title, "测试平台");
  });

  it("投稿人无法覆盖系统字段", () => {
    const malicious = { ...submission, id: 999, status_bool: false, updatetime: "1970-01-01" };
    const entry = data.toEntry(malicious, 7);
    assert.equal(entry.id, 7, "id 由入库流程决定");
    assert.equal(entry.status_bool, true, "状态不受投稿影响");
    assert.notOk(entry.updatetime === "1970-01-01", "日期由系统生成");
  });
});

describe("日期生成", () => {
  it("采用 yyyy-mm-dd 格式", () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(data.today()));
  });

  it("按东八区计算，避免 UTC 导致日期提前", () => {
    // Action 运行在 UTC，若不指定时区，东八区的凌晨会被记为前一天
    const shanghai = data.today("Asia/Shanghai");
    const utc = data.today("UTC");
    assert.ok(shanghai >= utc, "东八区日期不应早于 UTC");
  });
});
