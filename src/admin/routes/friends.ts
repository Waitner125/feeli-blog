import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { friendLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import {
	escapeAttribute,
	escapeHtml,
	parseOptionalPositiveInt,
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
			return { type: "success", message: "友链状态已更新" };
		case "deleted":
			return { type: "success", message: "友链记录已删除" };
		case "invalid-id":
			return { type: "error", message: "友链 ID 不合法" };
		case "invalid-status":
			return { type: "error", message: "友链状态不合法" };
		case "csrf-failed":
			return { type: "error", message: "CSRF 校验失败，请刷新页面后重试" };
		default:
			return undefined;
	}
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
			<article class="appearance-panel review-card">
				<div class="review-card-header">
					<div>
						<h3 class="review-card-title">${escapeHtml(item.name)}</h3>
						<p class="form-help review-card-meta">提交时间：${escapeHtml(formatDateTime(item.createdAt))}</p>
					</div>
					<span class="badge badge-${escapeAttribute(getFriendBadgeClass(item.status))}">${escapeHtml(getFriendStatusLabel(item.status))}</span>
				</div>

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
						<span class="review-item-value">${escapeHtml(item.description)}</span>
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
						</div>
						<div class="form-actions">
							<button type="submit" class="btn btn-primary btn-sm">保存审核</button>
						</div>
					</form>
					<form method="post" action="/api/admin/friends/${item.id}/delete" data-confirm-message="${escapeAttribute("确认删除这条友链记录吗？")}" class="review-delete-form">
						<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
						<button type="submit" class="btn btn-sm btn-danger">删除记录</button>
					</form>
				</div>
			</article>
		`,
		)
		.join("");
}

function renderFriendsPage(options: {
	rows: FriendLinkRow[];
	csrfToken: string;
	alert?: { type: "success" | "error"; message: string };
}) {
	const { rows, csrfToken, alert } = options;
	const pendingRows = rows.filter((item) => item.status === "pending");
	const approvedRows = rows.filter((item) => item.status === "approved");
	const rejectedRows = rows.filter((item) => item.status === "rejected");
	const offlineRows = rows.filter((item) => item.status === "offline");

	return adminLayout(
		"友链管理",
		`
			<h1>友链管理</h1>
			<p class="form-help" style="margin-bottom: 1rem;">审核前台友链申请，支持通过、拒绝、下架与删除记录。</p>
			${alert ? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>` : ""}

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">待审核（${pendingRows.length}）</h2>
				${renderFriendRows(pendingRows, csrfToken)}
			</section>

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">已通过（${approvedRows.length}）</h2>
				${renderFriendRows(approvedRows, csrfToken)}
			</section>

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">已拒绝（${rejectedRows.length}）</h2>
				${renderFriendRows(rejectedRows, csrfToken)}
			</section>

			<section>
				<h2 style="margin-bottom: 0.8rem;">已下架（${offlineRows.length}）</h2>
				${renderFriendRows(offlineRows, csrfToken)}
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

	const rows = await db
		.select()
		.from(friendLinks)
		.orderBy(desc(friendLinks.createdAt));

	return c.html(
		renderFriendsPage({
			rows,
			csrfToken: session.csrfToken,
			alert: resolveAlert(status),
		}),
	);
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

	const reviewNote =
		sanitizePlainText(getBodyText(body, "reviewNote"), 320, {
			allowNewlines: true,
		}) || null;
	const now = new Date().toISOString();
	const db = getDb(c.env.DB);

	await db
		.update(friendLinks)
		.set({
			status: nextStatus,
			reviewNote,
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
