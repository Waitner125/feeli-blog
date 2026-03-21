import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { friendLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import { sanitizeCanonicalUrl, sanitizePlainText } from "@/lib/security";
import type { AdminAppEnv } from "../middleware/auth";

const friendLinksRoutes = new Hono<AdminAppEnv>();
const AVATAR_PROXY_TIMEOUT_MS = 8_000;
const AVATAR_PROXY_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_PROXY_CACHE_SECONDS = 6 * 60 * 60;

interface FriendLinkApplicationInput {
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
}

interface TurnstileVerifyResponse {
	success?: boolean;
	"error-codes"?: string[];
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return false;
	}

	const [a, b] = parts;
	if (a === 10 || a === 127 || a === 0) {
		return true;
	}

	if (a === 169 && b === 254) {
		return true;
	}

	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}

	if (a === 192 && b === 168) {
		return true;
	}

	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}

	return a === 198 && (b === 18 || b === 19);
}

function normalizeHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}

	return normalized;
}

function isPrivateIpv6(hostname: string): boolean {
	if (!hostname.includes(":")) {
		return false;
	}

	if (
		hostname === "::1" ||
		hostname.startsWith("fe80:") ||
		hostname.startsWith("fc") ||
		hostname.startsWith("fd")
	) {
		return true;
	}

	return hostname.startsWith("::ffff:");
}

function isBlockedSourceHost(hostname: string): boolean {
	const normalized = normalizeHostname(hostname);
	if (!normalized) {
		return true;
	}

	if (
		normalized === "localhost" ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal")
	) {
		return true;
	}

	if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) {
		return true;
	}

	return false;
}

function validateAvatarTarget(target: URL, requestUrl: URL): string | null {
	if (!["http:", "https:"].includes(target.protocol)) {
		return "头像地址仅支持 http/https 协议";
	}

	if (target.username || target.password) {
		return "头像地址不允许携带用户名或密码";
	}

	if (isBlockedSourceHost(target.hostname)) {
		return "头像地址不允许使用本地或内网主机";
	}

	if (
		target.origin === requestUrl.origin &&
		target.pathname.startsWith("/api/friend-links/avatar")
	) {
		return "头像地址无效";
	}

	return null;
}

function getBodyText(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (Array.isArray(value)) {
		const firstText = value.find(
			(item): item is string => typeof item === "string",
		);
		return firstText?.trim() ?? "";
	}

	return typeof value === "string" ? value.trim() : "";
}

function parseApplicationInput(
	body: Record<string, unknown>,
): { data: FriendLinkApplicationInput } | { error: "invalid" } {
	const name = sanitizePlainText(getBodyText(body, "name"), 80);
	const description = sanitizePlainText(getBodyText(body, "description"), 320, {
		allowNewlines: true,
	});
	const contact = sanitizePlainText(getBodyText(body, "contact"), 120, {
		allowNewlines: true,
	});
	const note =
		sanitizePlainText(getBodyText(body, "note"), 320, {
			allowNewlines: true,
		}) || null;
	const siteUrl = sanitizeCanonicalUrl(getBodyText(body, "siteUrl"));
	const rawAvatarUrl = getBodyText(body, "avatarUrl");
	const avatarUrl = rawAvatarUrl ? sanitizeCanonicalUrl(rawAvatarUrl) : null;

	if (!name || !contact || !siteUrl) {
		return { error: "invalid" } as const;
	}

	if (rawAvatarUrl && !avatarUrl) {
		return { error: "invalid" } as const;
	}

	return {
		data: {
			name,
			siteUrl,
			avatarUrl,
			description,
			contact,
			note,
		},
	} as const;
}

async function verifyTurnstileToken(c: Context<AdminAppEnv>, token: string) {
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

	const remoteIp =
		c.req.header("CF-Connecting-IP") ||
		c.req
			.header("x-forwarded-for")
			?.split(",")
			.map((item) => item.trim())
			.filter(Boolean)[0];
	if (remoteIp) {
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

friendLinksRoutes.post("/apply", async (c) => {
	const db = getDb(c.env.DB);
	const body = await c.req.parseBody();
	const turnstileToken = getBodyText(body, "cf-turnstile-response");
	const verifyResult = await verifyTurnstileToken(c, turnstileToken);
	if (!verifyResult.success) {
		return c.redirect("/friends/apply?apply=challenge-failed");
	}

	const parsed = parseApplicationInput(body);
	if ("error" in parsed) {
		return c.redirect("/friends/apply?apply=invalid");
	}

	const now = new Date().toISOString();
	const [existing] = await db
		.select({
			id: friendLinks.id,
			status: friendLinks.status,
		})
		.from(friendLinks)
		.where(eq(friendLinks.siteUrl, parsed.data.siteUrl))
		.limit(1);

	if (existing) {
		if (["pending", "approved", "offline"].includes(existing.status)) {
			return c.redirect("/friends/apply?apply=duplicate");
		}

		await db
			.update(friendLinks)
			.set({
				name: parsed.data.name,
				avatarUrl: parsed.data.avatarUrl,
				description: parsed.data.description,
				contact: parsed.data.contact,
				note: parsed.data.note,
				status: "pending",
				reviewNote: null,
				reviewedAt: null,
				updatedAt: now,
			})
			.where(eq(friendLinks.id, existing.id));

		return c.redirect("/friends/apply?apply=success");
	}

	await db.insert(friendLinks).values({
		name: parsed.data.name,
		siteUrl: parsed.data.siteUrl,
		avatarUrl: parsed.data.avatarUrl,
		description: parsed.data.description,
		contact: parsed.data.contact,
		note: parsed.data.note,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	});

	return c.redirect("/friends/apply?apply=success");
});

friendLinksRoutes.get("/avatar", async (c) => {
	const rawUrl = sanitizeCanonicalUrl(c.req.query("url"));
	if (!rawUrl) {
		return c.text("头像地址不合法", 400);
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(rawUrl);
	} catch {
		return c.text("头像地址不合法", 400);
	}

	const validateError = validateAvatarTarget(targetUrl, new URL(c.req.url));
	if (validateError) {
		return c.text(validateError, 400);
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, AVATAR_PROXY_TIMEOUT_MS);

	try {
		const response = await fetch(targetUrl.toString(), {
			method: "GET",
			headers: {
				accept:
					"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				"user-agent": "cf-astro-blog-friend-avatar-proxy/1.0",
			},
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			return c.text("头像暂时不可用", 502);
		}

		const contentType =
			sanitizePlainText(
				response.headers.get("content-type"),
				120,
			).toLowerCase() || "application/octet-stream";
		if (!contentType.startsWith("image/")) {
			return c.text("头像资源类型不支持", 415);
		}

		const data = await response.arrayBuffer();
		if (data.byteLength > AVATAR_PROXY_MAX_BYTES) {
			return c.text("头像文件过大", 413);
		}

		return new Response(data, {
			headers: {
				"content-type": contentType,
				"cache-control": `public, max-age=${AVATAR_PROXY_CACHE_SECONDS}, stale-while-revalidate=86400`,
				"x-content-type-options": "nosniff",
			},
		});
	} catch {
		return c.text("头像拉取失败", 502);
	} finally {
		clearTimeout(timeout);
	}
});

export { friendLinksRoutes };
