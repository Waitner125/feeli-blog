import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { friendLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import { sanitizeCanonicalUrl, sanitizePlainText } from "@/lib/security";
import type { AdminAppEnv } from "../middleware/auth";

const friendLinksRoutes = new Hono<AdminAppEnv>();

interface FriendLinkApplicationInput {
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
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

	if (!name || !description || !contact || !siteUrl) {
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

friendLinksRoutes.post("/apply", async (c) => {
	const db = getDb(c.env.DB);
	const body = await c.req.parseBody();
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

export { friendLinksRoutes };
