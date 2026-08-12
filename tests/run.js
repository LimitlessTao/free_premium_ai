#!/usr/bin/env node
/**
 * 测试入口：node tests/run.js
 *
 * 覆盖不依赖外部服务的逻辑。需要真实操作确认的部分
 * （GitHub 预填页渲染、Pages 部署行为）见 docs/testing.md 的手工验证清单。
 */

import "./validate.test.js";
import "./platform-data.test.js";
import "./render.test.js";
import "./issue-payload.test.js";
import "./submit.test.js";
import "./build-injection.test.js";
import { run } from "./harness.js";

await run();
