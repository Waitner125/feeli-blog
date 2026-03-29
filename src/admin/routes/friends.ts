import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { friendLinks, siteAppearanceSettings } from "@/db/schema";
import { getDb } from "@/lib/db";
import {
	escapeAttribute,
	escapeHtml,
	parseOptionalPositiveInt,
	sanitizeCanonicalUrl,
	sanitizePlainText,
} from "@/lib/security";
import {
	type AdminAppEnv,
	assertCsrfToken,
	getAuthenticatedSession,
	getBodyText,
	requireAuth,
} from "../middleware/auth";
import { adminLayout } from "../views/layout";

const friendsRoutes = new Hono<AdminAppEnv>();

const FRIEND_LINK_STATUS_VALUES = [
	"pending",
	"approved",
	"rejected",
	"offline",
] as const;

type FriendLinkStatus = (typeof FRIEND_LINK_STATUS_VALUES)[number];

interface FriendLinkRow {
	id: number;
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
	status: string;
	reviewNote: string | null;
	reviewedAt: string | null;
	createdAt: string;
}

interface FriendLinkCreateInput {
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
	status: FriendLinkStatus;
	reviewNote: string | null;
}

interface FriendLinkFormFieldMap {
	nameKey: string;
	siteUrlKey: string;
	avatarUrlKey: string;
	descriptionKey: string;
	contactKey: string;
	noteKey: string;
	statusKey: string;
	reviewNoteKey: string;
}

function normalizeFriendLinkStatus(value: unknown): FriendLinkStatus | null {
	const normalized = String(value ?? "").trim();
	return FRIEND_LINK_STATUS_VALUES.includes(normalized as FriendLinkStatus)
		? (normalized as FriendLinkStatus)
		: null;
}

function getFriendStatusLabel(status: string) {
	switch (normalizeFriendLinkStatus(status)) {
		case "approved":
			return "已通过";
		case "rejected":
			return "已拒绝";
		case "offline":
			return "已下架";
		default:
			return "待审核";
	}
}

function getFriendBadgeClass(status: string) {
	switch (normalizeFriendLinkStatus(status)) {
		case "approved":
			return "published";
		case "pending":
			return "scheduled";
		default:
			return "draft";
	}
}

function resolveAlert(
	status: string | null,
): { type: "success" | "error"; message: string } | undefined {
	switch (status) {
		case "updated":
			return { type: "success", message: "友链信息已更新" };
		case "deleted":
			return { type: "success", message: "友链记录已删除" };
		case "created":
			return { type: "success", message: "友链已添加，可立即在列表中管理" };
		case "settings-updated":
			return { type: "success", message: "友链申请公示已更新" };
		case "invalid-id":
			return { type: "error", message: "友链 ID 不合法" };
		case "invalid-status":
			return { type: "error", message: "友链状态不合法" };
		case "create-invalid":
			return { type: "error", message: "新增友链参数不完整或格式无效" };
		case "create-duplicate":
			return { type: "error", message: "该站点地址已存在，无法重复添加" };
		case "update-invalid":
			return { type: "error", message: "保存失败，参数不完整或格式无效" };
		case "update-duplicate":
			return { type: "error", message: "保存失败，站点地址与其他记录重复" };
		case "csrf-failed":
			return { type: "error", message: "CSRF 校验失败，请刷新页面后重试" };
		default:
			return undefined;
	}
}

function parseFriendCreateInput(
	body: Record<string, unknown>,
): { data: FriendLinkCreateInput } | { error: "invalid" } {
	return parseFriendFormInput(body, {
		nameKey: "createName",
		siteUrlKey: "createSiteUrl",
		avatarUrlKey: "createAvatarUrl",
		descriptionKey: "createDescription",
		contactKey: "createContact",
		noteKey: "createNote",
		statusKey: "createStatus",
		reviewNoteKey: "createReviewNote",
	});
}

function parseFriendReviewInput(
	body: Record<string, unknown>,
): { data: FriendLinkCreateInput } | { error: "invalid" } {
	return parseFriendFormInput(body, {
		nameKey: "name",
		siteUrlKey: "siteUrl",
		avatarUrlKey: "avatarUrl",
		descriptionKey: "description",
		contactKey: "contact",
		noteKey: "note",
		statusKey: "status",
		reviewNoteKey: "reviewNote",
	});
}

function parseFriendFormInput(
	body: Record<string, unknown>,
	fieldMap: FriendLinkFormFieldMap,
): { data: FriendLinkCreateInput } | { error: "invalid" } {
	const name = sanitizePlainText(getBodyText(body, fieldMap.nameKey), 80);
	const siteUrl = sanitizeCanonicalUrl(getBodyText(body, fieldMap.siteUrlKey));
	const rawAvatarUrl = getBodyText(body, fieldMap.avatarUrlKey);
	const avatarUrl = rawAvatarUrl ? sanitizeCanonicalUrl(rawAvatarUrl) : null;
	const description = sanitizePlainText(
		getBodyText(body, fieldMap.descriptionKey),
		320,
		{ allowNewlines: true },
	);
	const contact = sanitizePlainText(
		getBodyText(body, fieldMap.contactKey),
		120,
		{
			allowNewlines: true,
		},
	);
	const note =
		sanitizePlainText(getBodyText(body, fieldMap.noteKey), 320, {
			allowNewlines: true,
		}) || null;
	const reviewNote =
		sanitizePlainText(getBodyText(body, fieldMap.reviewNoteKey), 320, {
			allowNewlines: true,
		}) || null;
	const status = normalizeFriendLinkStatus(
		getBodyText(body, fieldMap.statusKey) || "approved",
	);

	if (!name || !siteUrl || !contact || !status) {
		return { error: "invalid" };
	}

	if (rawAvatarUrl && !avatarUrl) {
		return { error: "invalid" };
	}

	return {
		data: {
			name,
			siteUrl,
			avatarUrl,
			description,
			contact,
			note,
			status,
			reviewNote,
		},
	};
}

function formatDateTime(value: string | null | undefined): string {
	if (!value) {
		return "-";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return date.toLocaleString("zh-CN", { hour12: false });
}

function renderFriendRows(rows: FriendLinkRow[], csrfToken: string) {
	if (rows.length === 0) {
		return '<p class="form-help">当前没有记录。</p>';
	}

	return rows
		.map(
			(item) => `
			<details class="appearance-panel review-card friend-review-item">
				<summary class="friend-review-summary">
					<div class="friend-review-summary-main">
						<h3 class="review-card-title">${escapeHtml(item.name)}</h3>
						<p class="form-help review-card-meta">提交时间：${escapeHtml(formatDateTime(item.createdAt))}</p>
					</div>
					<div class="friend-review-summary-extra">
						<p class="friend-review-summary-site">${escapeHtml(item.siteUrl)}</p>
						<div class="friend-review-summary-state">
							<span class="badge badge-${escapeAttribute(getFriendBadgeClass(item.status))}">${escapeHtml(getFriendStatusLabel(item.status))}</span>
							<span class="friend-review-summary-caret" aria-hidden="true"></span>
						</div>
					</div>
				</summary>

				<div class="friend-review-content">
					<div class="review-card-body">
						<div class="review-item">
							<span class="review-item-label">站点</span>
							<span class="review-item-value"><a href="${escapeAttribute(item.siteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.siteUrl)}</a></span>
						</div>
						${
							item.avatarUrl
								? `<div class="review-item">
							<span class="review-item-label">头像</span>
							<span class="review-item-value"><a href="${escapeAttribute(item.avatarUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.avatarUrl)}</a></span>
						</div>`
								: ""
						}
						<div class="review-item review-item-span-2">
							<span class="review-item-label">简介</span>
							<span class="review-item-value">${item.description ? escapeHtml(item.description) : "（未填写）"}</span>
						</div>
						<div class="review-item">
							<span class="review-item-label">联系方式</span>
							<span class="review-item-value">${escapeHtml(item.contact)}</span>
						</div>
						<div class="review-item">
							<span class="review-item-label">最后审核</span>
							<span class="review-item-value">${escapeHtml(formatDateTime(item.reviewedAt))}</span>
						</div>
						${
							item.note
								? `<div class="review-item review-item-span-2">
							<span class="review-item-label">站长备注</span>
							<span class="review-item-value">${escapeHtml(item.note)}</span>
						</div>`
								: ""
						}
					</div>

					<div class="review-card-actions">
						<form method="post" action="/api/admin/friends/${item.id}/review" class="review-review-form">
							<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
							<div class="appearance-inline-grid">
								<div class="form-group form-group-tight">
									<label for="name-${item.id}">站点名称</label>
									<input id="name-${item.id}" name="name" class="form-input" maxlength="80" required value="${escapeAttribute(item.name)}" />
								</div>
								<div class="form-group form-group-tight">
									<label for="siteUrl-${item.id}">站点地址</label>
									<input id="siteUrl-${item.id}" name="siteUrl" class="form-input" type="url" maxlength="320" required value="${escapeAttribute(item.siteUrl)}" />
								</div>
								<div class="form-group form-group-tight">
									<label for="avatarUrl-${item.id}">头像地址（可选）</label>
									<input id="avatarUrl-${item.id}" name="avatarUrl" class="form-input" type="url" maxlength="320" value="${escapeAttribute(item.avatarUrl || "")}" />
								</div>
								<div class="form-group form-group-tight">
									<label for="contact-${item.id}">联系方式</label>
									<input id="contact-${item.id}" name="contact" class="form-input" maxlength="120" required value="${escapeAttribute(item.contact)}" />
								</div>
								<div class="form-group form-group-tight">
									<label for="status-${item.id}">审核状态</label>
									<select id="status-${item.id}" name="status" class="form-select">
										${FRIEND_LINK_STATUS_VALUES.map(
											(value) =>
												`<option value="${value}" ${item.status === value ? "selected" : ""}>${escapeHtml(getFriendStatusLabel(value))}</option>`,
										).join("")}
									</select>
								</div>
								<div class="form-group form-group-tight">
									<label for="reviewNote-${item.id}">审核备注</label>
									<input id="reviewNote-${item.id}" name="reviewNote" class="form-input" maxlength="320" value="${escapeAttribute(item.reviewNote || "")}" placeholder="可选" />
								</div>
								<div class="form-group" style="grid-column: 1 / -1;">
									<label for="description-${item.id}">站点简介（可选）</label>
									<textarea id="description-${item.id}" name="description" class="form-textarea" maxlength="320" rows="3">${escapeHtml(item.description)}</textarea>
								</div>
								<div class="form-group" style="grid-column: 1 / -1;">
									<label for="note-${item.id}">站长备注（可选）</label>
									<textarea id="note-${item.id}" name="note" class="form-textarea" maxlength="320" rows="3">${escapeHtml(item.note || "")}</textarea>
								</div>
							</div>
							<div class="form-actions">
								<button type="submit" class="btn btn-primary btn-sm">保存更改</button>
							</div>
						</form>
						<form method="post" action="/api/admin/friends/${item.id}/delete" data-confirm-message="${escapeAttribute("确认删除这条友链记录吗？")}" class="review-delete-form">
							<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
							<button type="submit" class="btn btn-sm btn-danger">删除记录</button>
						</form>
					</div>
				</div>
			</details>
		`,
		)
		.join("");
}

function renderCreateForm(csrfToken: string): string {
	const createStatusOptions: FriendLinkStatus[] = [
		"approved",
		"pending",
		"offline",
		"rejected",
	];

	return `
		<section id="friend-create-form" class="appearance-panel review-card">
			<h2 style="margin-bottom: 0.35rem;">新增友链</h2>
			<p class="form-help" style="margin-bottom: 0.9rem;">直接在后台录入并设置状态，不需要前台申请。</p>
			<form method="post" action="/api/admin/friends/create">
				<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
				<div class="appearance-inline-grid">
					<div class="form-group">
						<label for="createName">站点名称</label>
						<input id="createName" name="createName" class="form-input" maxlength="80" required />
					</div>
					<div class="form-group">
						<label for="createSiteUrl">站点地址</label>
						<input id="createSiteUrl" name="createSiteUrl" class="form-input" type="url" maxlength="320" placeholder="https://example.com" required />
					</div>
					<div class="form-group">
						<label for="createAvatarUrl">头像地址（可选）</label>
						<input id="createAvatarUrl" name="createAvatarUrl" class="form-input" type="url" maxlength="320" placeholder="https://example.com/avatar.png" />
					</div>
					<div class="form-group">
						<label for="createContact">联系方式</label>
						<input id="createContact" name="createContact" class="form-input" maxlength="120" placeholder="邮箱 / X / Telegram" required />
					</div>
					<div class="form-group">
						<label for="createStatus">初始状态</label>
						<select id="createStatus" name="createStatus" class="form-select">
							${createStatusOptions
								.map(
									(value) =>
										`<option value="${value}" ${value === "approved" ? "selected" : ""}>${escapeHtml(getFriendStatusLabel(value))}</option>`,
								)
								.join("")}
						</select>
					</div>
					<div class="form-group">
						<label for="createReviewNote">审核备注（可选）</label>
						<input id="createReviewNote" name="createReviewNote" class="form-input" maxlength="320" placeholder="例如：后台手动添加" />
					</div>
					<div class="form-group" style="grid-column: 1 / -1;">
						<label for="createDescription">站点简介（可选）</label>
						<textarea id="createDescription" name="createDescription" class="form-textarea" maxlength="320" rows="3"></textarea>
					</div>
					<div class="form-group" style="grid-column: 1 / -1;">
						<label for="createNote">站长备注（可选）</label>
						<textarea id="createNote" name="createNote" class="form-textarea" maxlength="320" rows="3"></textarea>
					</div>
				</div>
				<div class="form-actions">
					<button type="submit" class="btn btn-primary">添加友链</button>
				</div>
			</form>
		</section>
	`;
}

function renderFriendApplyNoticeForm(
	csrfToken: string,
	friendApplyNotice: string,
): string {
	return `
		<section class="appearance-panel review-card">
			<h2 style="margin-bottom: 0.35rem;">申请页公示</h2>
			<p class="form-help" style="margin-bottom: 0.9rem;">仅在「/friends/apply」申请页面展示，不会出现在友链列表页。</p>
			<form method="post" action="/api/admin/friends/settings">
				<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
				<div class="form-group" style="margin-bottom: 0.85rem;">
					<label for="friendApplyNotice">申请须知（可选）</label>
					<textarea id="friendApplyNotice" name="friendApplyNotice" class="form-textarea" maxlength="1200" rows="6" placeholder="例如：\n1. 请先在你的网站添加本站友链。\n2. 申请时请附上可联系到你的方式。">${escapeHtml(friendApplyNotice)}</textarea>
				</div>
				<div class="form-actions">
					<button type="submit" class="btn btn-primary">保存公示</button>
				</div>
			</form>
		</section>
	`;
}

function renderFriendsPage(options: {
	rows: FriendLinkRow[];
	csrfToken: string;
	friendApplyNotice: string;
	alert?: { type: "success" | "error"; message: string };
}) {
	const { rows, csrfToken, friendApplyNotice, alert } = options;
	const pendingCount = rows.filter((item) => item.status === "pending").length;

	return adminLayout(
		"友链管理",
		`
			<h1>友链管理</h1>
			<p class="form-help" style="margin-bottom: 1rem;">支持后台直接新增友链，也支持审核前台申请并管理状态。</p>
			${alert ? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>` : ""}
			<div class="page-actions">
				<a href="#friend-create-form" class="btn btn-primary">添加友链</a>
			</div>
			${renderFriendApplyNoticeForm(csrfToken, friendApplyNotice)}
			${renderCreateForm(csrfToken)}

			<section>
				<h2 style="margin-bottom: 0.2rem;">申请列表</h2>
				<p class="form-help" style="margin: 0 0 0.8rem;">共 ${rows.length} 条记录，待审核 ${pendingCount} 条。点击单条记录可展开审核详情。</p>
				${renderFriendRows(rows, csrfToken)}
			</section>
		`,
		{ csrfToken },
	);
}

friendsRoutes.use("*", requireAuth);

friendsRoutes.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const db = getDb(c.env.DB);
	const status = c.req.query("status") || null;

	const [rows, settingsRow] = await Promise.all([
		db.select().from(friendLinks).orderBy(desc(friendLinks.createdAt)),
		db
			.select({
				friendApplyNotice: siteAppearanceSettings.friendApplyNotice,
			})
			.from(siteAppearanceSettings)
			.where(eq(siteAppearanceSettings.id, 1))
			.limit(1)
			.then((records) => records[0] ?? null),
	]);

	return c.html(
		renderFriendsPage({
			rows,
			csrfToken: session.csrfToken,
			friendApplyNotice: settingsRow?.friendApplyNotice ?? "",
			alert: resolveAlert(status),
		}),
	);
});

friendsRoutes.post("/settings", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const friendApplyNotice = sanitizePlainText(
		getBodyText(body, "friendApplyNotice"),
		1200,
		{ allowNewlines: true },
	);
	const now = new Date().toISOString();
	const db = getDb(c.env.DB);

	await db
		.insert(siteAppearanceSettings)
		.values({
			id: 1,
			friendApplyNotice,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: siteAppearanceSettings.id,
			set: {
				friendApplyNotice,
				updatedAt: now,
			},
		});

	return c.redirect("/api/admin/friends?status=settings-updated");
});

friendsRoutes.post("/create", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const parsed = parseFriendCreateInput(body);
	if ("error" in parsed) {
		return c.redirect("/api/admin/friends?status=create-invalid");
	}

	const db = getDb(c.env.DB);
	const [existing] = await db
		.select({ id: friendLinks.id })
		.from(friendLinks)
		.where(eq(friendLinks.siteUrl, parsed.data.siteUrl))
		.limit(1);
	if (existing) {
		return c.redirect("/api/admin/friends?status=create-duplicate");
	}

	const now = new Date().toISOString();
	await db.insert(friendLinks).values({
		name: parsed.data.name,
		siteUrl: parsed.data.siteUrl,
		avatarUrl: parsed.data.avatarUrl,
		description: parsed.data.description,
		contact: parsed.data.contact,
		note: parsed.data.note,
		status: parsed.data.status,
		reviewNote: parsed.data.reviewNote,
		reviewedAt: parsed.data.status === "pending" ? null : now,
		createdAt: now,
		updatedAt: now,
	});

	return c.redirect("/api/admin/friends?status=created");
});

friendsRoutes.post("/:id/review", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/friends?status=invalid-id");
	}

	const nextStatus = normalizeFriendLinkStatus(getBodyText(body, "status"));
	if (!nextStatus) {
		return c.redirect("/api/admin/friends?status=invalid-status");
	}

	const parsed = parseFriendReviewInput(body);
	if ("error" in parsed) {
		return c.redirect("/api/admin/friends?status=update-invalid");
	}

	const now = new Date().toISOString();
	const db = getDb(c.env.DB);
	const [existing] = await db
		.select({ id: friendLinks.id })
		.from(friendLinks)
		.where(
			and(eq(friendLinks.siteUrl, parsed.data.siteUrl), ne(friendLinks.id, id)),
		)
		.limit(1);
	if (existing) {
		return c.redirect("/api/admin/friends?status=update-duplicate");
	}

	await db
		.update(friendLinks)
		.set({
			name: parsed.data.name,
			siteUrl: parsed.data.siteUrl,
			avatarUrl: parsed.data.avatarUrl,
			description: parsed.data.description,
			contact: parsed.data.contact,
			note: parsed.data.note,
			status: nextStatus,
			reviewNote: parsed.data.reviewNote,
			reviewedAt: nextStatus === "pending" ? null : now,
			updatedAt: now,
		})
		.where(eq(friendLinks.id, id));

	return c.redirect("/api/admin/friends?status=updated");
});

friendsRoutes.post("/:id/delete", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/friends?status=invalid-id");
	}

	const db = getDb(c.env.DB);
	await db.delete(friendLinks).where(eq(friendLinks.id, id));
	return c.redirect("/api/admin/friends?status=deleted");
});

export { friendsRoutes };
