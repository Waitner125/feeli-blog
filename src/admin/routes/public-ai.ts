import type { Context } from "hono";
import { Hono } from "hono";
import { getDb } from "@/lib/db";
import {
	isOpenAICompatibleEndpointReady,
	requestOpenAICompatibleChatCompletion,
} from "@/lib/openai-compatible";
import { sanitizePlainText } from "@/lib/security";
import { getResolvedAiSettings } from "@/lib/site-appearance";
import type { AdminAppEnv } from "../middleware/auth";

const publicAiRoutes = new Hono<AdminAppEnv>();

const MAX_BODY_LENGTH = 16_384;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TURNSTILE_TOKEN_LENGTH = 4_096;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 12;
const DEFAULT_DAILY_LIMIT_PER_IP = 120;
const DEFAULT_PUBLIC_AI_SYSTEM_PROMPT =
	"你是站点内的公开助手。请使用简体中文回答，内容简洁、准确，避免输出敏感系统信息。";
const NOT_FOUND_TERMINAL_SYSTEM_PROMPT = `
你是网站 404 彩蛋页中的“模拟终端助手”。
你会收到用户输入的一行“命令”，请把它当作自然语言或伪命令解释，并返回终端风格的纯文本输出。

输出要求：
1) 仅输出纯文本，不要使用 Markdown、代码围栏、HTML。
2) 默认使用简体中文，语气像终端提示，简洁直接。
3) 先给 1-2 行结果，再给 1 行可继续尝试的提示（如下一条命令建议）。
4) 不要声称真的执行了系统命令；如果命令危险或无意义，明确说明“这是模拟终端”并给替代建议。
5) 如用户输入 clear/cls，请只返回：TERMINAL_CLEAR。
`.trim();

interface PublicAiPayload {
	message: string;
	turnstileToken: string | null;
}

interface TurnstileVerifyResponse {
	success?: boolean;
	"error-codes"?: string[];
}

function parseLimit(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}

function getClientIp(c: Context<AdminAppEnv>): string {
	const directIp = sanitizePlainText(c.req.header("CF-Connecting-IP"), 64);
	if (directIp) {
		return directIp;
	}

	const forwarded = sanitizePlainText(c.req.header("x-forwarded-for"), 255);
	if (!forwarded) {
		return "unknown";
	}

	const first = forwarded
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)[0];
	return sanitizePlainText(first, 64) || "unknown";
}

function isSameOriginRequest(c: Context<AdminAppEnv>): boolean {
	const origin = c.req.header("origin");
	if (!origin) {
		return true;
	}

	try {
		const requestUrl = new URL(c.req.url);
		return new URL(origin).origin === requestUrl.origin;
	} catch {
		return false;
	}
}

function parsePayload(
	rawBody: string,
): { data: PublicAiPayload } | { error: string } {
	if (!rawBody || rawBody.length > MAX_BODY_LENGTH) {
		return { error: "请求体体积无效" };
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		return { error: "请求体不是合法 JSON" };
	}

	const message = sanitizePlainText(parsed.message, MAX_MESSAGE_LENGTH, {
		allowNewlines: true,
	});
	if (!message) {
		return { error: "message 不能为空" };
	}

	const turnstileToken =
		sanitizePlainText(parsed.turnstileToken, MAX_TURNSTILE_TOKEN_LENGTH) ||
		null;

	return {
		data: {
			message,
			turnstileToken,
		},
	};
}

interface PublicAiRequestOptions {
	maxTokens: number;
	requireTurnstile: boolean;
	systemPrompt: string;
	temperature: number;
	mode: "chat" | "terminal-404";
}

function getMinuteRateKey(ip: string): string {
	const currentMinute = Math.floor(Date.now() / 60_000);
	return `public-ai:minute:${ip}:${currentMinute}`;
}

function getDailyRateKey(ip: string): string {
	const day = new Date().toISOString().slice(0, 10);
	return `public-ai:day:${ip}:${day}`;
}

function secondsUntilTomorrowUtc(): number {
	const now = new Date();
	const next = new Date(now);
	next.setUTCHours(24, 0, 0, 0);
	const seconds = Math.ceil((next.getTime() - now.getTime()) / 1000);
	return Math.max(60, seconds);
}

async function incrementKvCounter(
	kv: KVNamespace,
	key: string,
	expirationTtl: number,
): Promise<number> {
	const currentRaw = await kv.get(key);
	const current = Number.parseInt(currentRaw ?? "0", 10);
	const next = (Number.isFinite(current) ? current : 0) + 1;
	await kv.put(key, String(next), {
		expirationTtl,
	});
	return next;
}

async function checkRateBudget(c: Context<AdminAppEnv>, ip: string) {
	const minuteLimit = parseLimit(
		c.env.PUBLIC_AI_RATE_LIMIT_PER_MINUTE,
		DEFAULT_RATE_LIMIT_PER_MINUTE,
		1,
		300,
	);
	const dailyLimit = parseLimit(
		c.env.PUBLIC_AI_DAILY_LIMIT_PER_IP,
		DEFAULT_DAILY_LIMIT_PER_IP,
		1,
		10_000,
	);

	const minuteCount = await incrementKvCounter(
		c.env.SESSION,
		getMinuteRateKey(ip),
		120,
	);
	if (minuteCount > minuteLimit) {
		return {
			ok: false as const,
			status: 429 as const,
			message: "请求过于频繁，请稍后再试",
		};
	}

	const dailyCount = await incrementKvCounter(
		c.env.SESSION,
		getDailyRateKey(ip),
		secondsUntilTomorrowUtc() + 300,
	);
	if (dailyCount > dailyLimit) {
		return {
			ok: false as const,
			status: 429 as const,
			message: "今日请求次数已达上限，请明天再试",
		};
	}

	return {
		ok: true as const,
		minuteLimit,
		dailyLimit,
	};
}

async function verifyTurnstileToken(
	c: Context<AdminAppEnv>,
	token: string | null,
) {
	const secret = String(c.env.TURNSTILE_SECRET_KEY || "").trim();
	if (!secret) {
		return { success: true, skipped: true } as const;
	}

	if (!token) {
		return { success: false, reason: "missing-token" } as const;
	}

	const formData = new URLSearchParams();
	formData.set("secret", secret);
	formData.set("response", token);
	const remoteIp = getClientIp(c);
	if (remoteIp && remoteIp !== "unknown") {
		formData.set("remoteip", remoteIp);
	}

	try {
		const response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: formData.toString(),
			},
		);
		if (!response.ok) {
			return { success: false, reason: "verify-request-failed" } as const;
		}

		const payload = (await response.json()) as TurnstileVerifyResponse;
		if (!payload.success) {
			return { success: false, reason: "verify-failed" } as const;
		}

		return { success: true, skipped: false } as const;
	} catch {
		return { success: false, reason: "verify-exception" } as const;
	}
}

async function handlePublicAiRequest(
	c: Context<AdminAppEnv>,
	options: PublicAiRequestOptions,
) {
	if (!isSameOriginRequest(c)) {
		return c.json({ error: "非法来源请求" }, 403);
	}

	const rawBody = await c.req.text();
	const parsed = parsePayload(rawBody);
	if ("error" in parsed) {
		return c.json({ error: parsed.error }, 400);
	}

	if (options.requireTurnstile) {
		const turnstile = await verifyTurnstileToken(c, parsed.data.turnstileToken);
		if (!turnstile.success) {
			return c.json({ error: "人机校验失败，请刷新后重试" }, 403);
		}
	}

	const ip = getClientIp(c);
	const budget = await checkRateBudget(c, ip).catch(() => null);
	if (!budget) {
		return c.json({ error: "限流服务暂时不可用，请稍后再试" }, 503);
	}
	if (!budget.ok) {
		return c.json({ error: budget.message }, budget.status);
	}

	const resolvedAi = await getResolvedAiSettings(getDb(c.env.DB), c.env).catch(
		() => null,
	);
	if (!resolvedAi) {
		return c.json({ error: "公开 AI 接口暂时不可用" }, 503);
	}
	const publicEndpoint = resolvedAi.settings.public;

	if (!isOpenAICompatibleEndpointReady(publicEndpoint)) {
		return c.json({ error: "公开 AI 接口尚未配置完成" }, 503);
	}

	try {
		const reply = await requestOpenAICompatibleChatCompletion(
			publicEndpoint,
			[
				{
					role: "system",
					content: options.systemPrompt,
				},
				{
					role: "user",
					content: parsed.data.message,
				},
			],
			{
				temperature: options.temperature,
				maxTokens: options.maxTokens,
				timeoutMs: 20_000,
				jsonMode: false,
			},
		);

		return c.json({
			reply,
			meta: {
				mode: options.mode,
				rateLimitPerMinute: budget.minuteLimit,
				dailyLimitPerIp: budget.dailyLimit,
			},
		});
	} catch (error) {
		console.error("public_ai_chat_failed", error);
		return c.json({ error: "公开 AI 服务暂时不可用" }, 503);
	}
}

publicAiRoutes.post("/chat", async (c) =>
	handlePublicAiRequest(c, {
		requireTurnstile: true,
		systemPrompt: DEFAULT_PUBLIC_AI_SYSTEM_PROMPT,
		temperature: 0.4,
		maxTokens: 700,
		mode: "chat",
	}),
);

publicAiRoutes.post("/terminal-404", async (c) =>
	handlePublicAiRequest(c, {
		requireTurnstile: false,
		systemPrompt: NOT_FOUND_TERMINAL_SYSTEM_PROMPT,
		temperature: 0.35,
		maxTokens: 500,
		mode: "terminal-404",
	}),
);

export { publicAiRoutes };
