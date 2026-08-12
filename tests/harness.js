/**
 * 极简测试运行器
 *
 * 不引入外部依赖：项目本身零依赖，为测试拉入框架会打破这一点，
 * 也会让 Cloudflare 构建多出安装步骤。
 */

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error("it() 必须写在 describe() 内");
  current.cases.push({ name, fn });
}

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Error) return value.message;
  return JSON.stringify(value);
}

export const assert = {
  ok(value, message) {
    if (!value) throw new Error(message || `期望为真，实际是 ${format(value)}`);
  },
  notOk(value, message) {
    if (value) throw new Error(message || `期望为假，实际是 ${format(value)}`);
  },
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `期望 ${format(expected)}，实际 ${format(actual)}`);
    }
  },
  deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(message || `期望 ${b}，实际 ${a}`);
    }
  },
  includes(haystack, needle, message) {
    if (!String(haystack).includes(needle)) {
      throw new Error(message || `期望包含 ${format(needle)}`);
    }
  },
  async rejects(fn, message) {
    try {
      await fn();
    } catch {
      return;
    }
    throw new Error(message || "期望抛出异常，但正常返回了");
  },
};

export async function run() {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const testCase of suite.cases) {
      try {
        await testCase.fn();
        passed += 1;
        console.log(`  ✓ ${testCase.name}`);
      } catch (err) {
        failures.push({ suite: suite.name, name: testCase.name, err });
        console.log(`  ✗ ${testCase.name}`);
        console.log(`    ${err.message}`);
      }
    }
  }

  const total = passed + failures.length;
  console.log(`\n${passed}/${total} 通过`);

  if (failures.length) {
    process.exitCode = 1;
  }
}
