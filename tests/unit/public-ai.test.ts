import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("公开 AI 接口防护", () => {
	test("公开 AI 路由包含同源校验、限流配额与 Turnstile 校验", async () => {
		const source = await readFile("src/admin/routes/public-ai.ts", "utf8");

		assert.match(source, /isSameOriginRequest/u);
		assert.match(source, /public-ai:minute:/u);
		assert.match(source, /public-ai:day:/u);
		assert.match(source, /PUBLIC_AI_RATE_LIMIT_PER_MINUTE/u);
		assert.match(source, /PUBLIC_AI_DAILY_LIMIT_PER_IP/u);
		assert.match(source, /TURNSTILE_SECRET_KEY/u);
		assert.match(source, /verifyTurnstileToken/u);
		assert.match(source, /\/chat/u);
	});

	test("主应用会挂载公开 AI 路由", async () => {
		const appSource = await readFile("src/admin/app.ts", "utf8");
		assert.match(appSource, /app\.route\("\/ai", publicAiRoutes\)/u);
	});
});
