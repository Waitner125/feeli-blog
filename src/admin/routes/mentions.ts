import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { webMentions } from "@/db/schema";
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

const mentionsRoutes = new Hono<AdminAppEnv>();

const WEBMENTION_STATUS_VALUES = [
	"pending",
	"approved",
	"rejected",
	"spam",
] as const;

type WebMentionStatus = (typeof WEBMENTION_STATUS_VALUES)[number];

interface WebMentionRow {
	id: number;
	sourceUrl: string;
	targetUrl: string;
	sourceTitle: string | null;
	sourceExcerpt: string | null;
	sourceAuthor: string | null;
	sourcePublishedAt: string | null;
	status: string;
	reviewNote: string | null;
	reviewedAt: string | null;
	lastCheckedAt: string | null;
	createdAt: string;
}

function normalizeWebMentionStatus(value: unknown): WebMentionStatus | null {
	const normalized = String(value ?? "").trim();
	return WEBMENTION_STATUS_VALUES.includes(normalized as WebMentionStatus)
		? (normalized as WebMentionStatus)
		: null;
}

function getStatusLabel(status: string) {
	switch (normalizeWebMentionStatus(status)) {
		case "approved":
			return "已通过";
		case "rejected":
			return "已拒绝";
		case "spam":
			return "垃圾";
		default:
			return "待审核";
	}
}

function getStatusBadgeClass(status: string) {
	switch (normalizeWebMentionStatus(status)) {
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
			return { type: "success", message: "提及审核状态已更新" };
		case "deleted":
			return { type: "success", message: "提及记录已删除" };
		case "invalid-id":
			return { type: "error", message: "提及 ID 不合法" };
		case "invalid-status":
			return { type: "error", message: "审核状态不合法" };
		case "csrf-failed":
			return { type: "error", message: "CSRF 校验失败，请刷新后重试" };
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

function renderRows(rows: WebMentionRow[], csrfToken: string) {
	if (rows.length === 0) {
		return '<p class="form-help">当前没有记录。</p>';
	}

	return rows
		.map(
			(item) => `
				<article class="appearance-panel review-card">
					<div class="review-card-header">
						<div>
							<h3 class="review-card-title">${escapeHtml(item.sourceTitle || "未解析标题")}</h3>
							<p class="form-help review-card-meta">
								提交时间：${escapeHtml(formatDateTime(item.createdAt))}${item.lastCheckedAt ? ` · 最近校验：${escapeHtml(formatDateTime(item.lastCheckedAt))}` : ""}
							</p>
						</div>
						<span class="badge badge-${escapeAttribute(getStatusBadgeClass(item.status))}">${escapeHtml(getStatusLabel(item.status))}</span>
					</div>

					<div class="review-card-body">
						<div class="review-item">
							<span class="review-item-label">来源链接</span>
							<span class="review-item-value"><a href="${escapeAttribute(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceUrl)}</a></span>
						</div>
						<div class="review-item">
							<span class="review-item-label">目标链接</span>
							<span class="review-item-value"><a href="${escapeAttribute(item.targetUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.targetUrl)}</a></span>
						</div>
						${
							item.sourceAuthor
								? `<div class="review-item">
							<span class="review-item-label">作者</span>
							<span class="review-item-value">${escapeHtml(item.sourceAuthor)}</span>
						</div>`
								: ""
						}
						${
							item.sourcePublishedAt
								? `<div class="review-item">
							<span class="review-item-label">来源发布时间</span>
							<span class="review-item-value">${escapeHtml(formatDateTime(item.sourcePublishedAt))}</span>
						</div>`
								: ""
						}
						${
							item.sourceExcerpt
								? `<div class="review-item review-item-span-2">
							<span class="review-item-label">摘要</span>
							<span class="review-item-value">${escapeHtml(item.sourceExcerpt)}</span>
						</div>`
								: ""
						}
						<div class="review-item">
							<span class="review-item-label">最后审核</span>
							<span class="review-item-value">${escapeHtml(formatDateTime(item.reviewedAt))}</span>
						</div>
					</div>

					<div class="review-card-actions">
						<form method="post" action="/api/admin/mentions/${item.id}/review" class="review-review-form">
							<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
							<div class="appearance-inline-grid">
								<div class="form-group form-group-tight">
									<label for="status-${item.id}">审核状态</label>
									<select id="status-${item.id}" name="status" class="form-select">
										${WEBMENTION_STATUS_VALUES.map(
											(value) =>
												`<option value="${value}" ${item.status === value ? "selected" : ""}>${escapeHtml(getStatusLabel(value))}</option>`,
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

						<form method="post" action="/api/admin/mentions/${item.id}/delete" data-confirm-message="${escapeAttribute("确认删除这条提及记录吗？")}" class="review-delete-form">
							<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
							<button type="submit" class="btn btn-sm btn-danger">删除记录</button>
						</form>
					</div>
				</article>
			`,
		)
		.join("");
}

function renderMentionsPage(options: {
	rows: WebMentionRow[];
	csrfToken: string;
	alert?: { type: "success" | "error"; message: string };
}) {
	const { rows, csrfToken, alert } = options;
	const pendingRows = rows.filter((item) => item.status === "pending");
	const approvedRows = rows.filter((item) => item.status === "approved");
	const rejectedRows = rows.filter((item) => item.status === "rejected");
	const spamRows = rows.filter((item) => item.status === "spam");

	return adminLayout(
		"提及管理",
		`
			<h1>提及管理</h1>
			<p class="form-help" style="margin-bottom: 1rem;">审核 Webmention 提及，按需通过、拒绝或标记为垃圾。</p>
			${alert ? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>` : ""}

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">待审核（${pendingRows.length}）</h2>
				${renderRows(pendingRows, csrfToken)}
			</section>

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">已通过（${approvedRows.length}）</h2>
				${renderRows(approvedRows, csrfToken)}
			</section>

			<section style="margin-bottom: 1.2rem;">
				<h2 style="margin-bottom: 0.8rem;">已拒绝（${rejectedRows.length}）</h2>
				${renderRows(rejectedRows, csrfToken)}
			</section>

			<section>
				<h2 style="margin-bottom: 0.8rem;">垃圾（${spamRows.length}）</h2>
				${renderRows(spamRows, csrfToken)}
			</section>
		`,
		{ csrfToken },
	);
}

mentionsRoutes.use("*", requireAuth);

mentionsRoutes.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const db = getDb(c.env.DB);
	const status = c.req.query("status") || null;

	const rows = await db
		.select()
		.from(webMentions)
		.orderBy(desc(webMentions.createdAt));

	return c.html(
		renderMentionsPage({
			rows,
			csrfToken: session.csrfToken,
			alert: resolveAlert(status),
		}),
	);
});

mentionsRoutes.post("/:id/review", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/mentions?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/mentions?status=invalid-id");
	}

	const nextStatus = normalizeWebMentionStatus(getBodyText(body, "status"));
	if (!nextStatus) {
		return c.redirect("/api/admin/mentions?status=invalid-status");
	}

	const reviewNote =
		sanitizePlainText(getBodyText(body, "reviewNote"), 320, {
			allowNewlines: true,
		}) || null;
	const now = new Date().toISOString();
	const db = getDb(c.env.DB);

	await db
		.update(webMentions)
		.set({
			status: nextStatus,
			reviewNote,
			reviewedAt: nextStatus === "pending" ? null : now,
			updatedAt: now,
		})
		.where(eq(webMentions.id, id));

	return c.redirect("/api/admin/mentions?status=updated");
});

mentionsRoutes.post("/:id/delete", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/mentions?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/mentions?status=invalid-id");
	}

	const db = getDb(c.env.DB);
	await db.delete(webMentions).where(eq(webMentions.id, id));
	return c.redirect("/api/admin/mentions?status=deleted");
});

export { mentionsRoutes };
