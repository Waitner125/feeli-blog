import { escapeHtml } from "@/lib/security";
import { adminSharedStyles } from "./layout";

interface LoginPageOptions {
	error?: string;
	githubLogin?: string;
	oauthEnabled?: boolean;
}

export function loginPage(options: LoginPageOptions = {}): string {
	const { error, githubLogin, oauthEnabled = false } = options;

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>GitHub OAuth 登录</title>
	<meta name="robots" content="noindex, nofollow" />
	<style>
${adminSharedStyles}

		body {
			display: grid;
			place-items: center;
			padding: 1.25rem;
		}

		.login-shell {
			position: relative;
			z-index: 1;
			width: min(560px, calc(100vw - 2rem));
		}

		.login-hero {
			margin-bottom: 0.8rem;
			padding: 0.58rem 0.9rem;
			border-radius: var(--radius-pill);
			border: 1px solid var(--border);
			background: var(--bg-tertiary);
			color: var(--text-muted);
			font-size: 0.82rem;
			letter-spacing: 0.03em;
		}

		.login-card {
			position: relative;
			background: var(--bg-secondary);
			border: 1px solid var(--border);
			border-radius: 36px;
			backdrop-filter: blur(24px) saturate(140%);
			box-shadow: var(--shadow-strong);
			overflow: hidden;
		}

		.login-card::before {
			content: "";
			position: absolute;
			inset: 0;
			pointer-events: none;
			background:
				radial-gradient(circle at top left, rgba(10, 132, 255, 0.18), transparent 28%),
				linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 26%);
		}

		.login-card {
			padding: 1.65rem;
			display: grid;
			align-content: center;
		}

		.login-card-inner {
			position: relative;
			display: grid;
			gap: 1rem;
			padding: 1.4rem;
			border-radius: 30px;
			background: rgba(255, 255, 255, 0.18);
			border: 1px solid var(--border);
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
		}

		.login-card-header {
			display: grid;
			gap: 0.45rem;
		}

		.login-card-header h2 {
			margin: 0;
			font-size: 1.75rem;
			color: var(--text);
		}

		.login-hint {
			color: var(--text-secondary);
			line-height: 1.6;
			font-size: 0.92rem;
		}

		.login-notice {
			padding: 0.95rem 1rem;
			border-radius: 24px;
			background: rgba(10, 132, 255, 0.12);
			border: 1px solid rgba(10, 132, 255, 0.16);
			color: var(--text-secondary);
			line-height: 1.6;
		}

		.login-notice strong {
			color: var(--text);
		}

		.oauth-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 0.7rem;
			width: 100%;
			padding: 0.95rem 1.15rem;
			border-radius: var(--radius-pill);
			border: 1px solid transparent;
			background:
				linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent 72%),
				var(--accent);
			color: #fff;
			font-size: 0.98rem;
			font-weight: 700;
			letter-spacing: 0.01em;
			box-shadow:
				0 20px 40px -26px rgba(10, 132, 255, 0.56),
				inset 0 1px 0 rgba(255, 255, 255, 0.18);
			transition:
				transform var(--transition-fast),
				box-shadow var(--transition-fast),
				background-color var(--transition-fast);
		}

		.oauth-button:hover {
			color: #fff;
			transform: translate3d(0, -2px, 0);
			background:
				linear-gradient(135deg, rgba(255, 255, 255, 0.22), transparent 72%),
				var(--accent-hover);
		}

		.oauth-button[aria-disabled="true"] {
			opacity: 0.58;
			pointer-events: none;
			box-shadow: none;
		}

		.oauth-mark {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2rem;
			height: 2rem;
			border-radius: 999px;
			background: rgba(0, 0, 0, 0.18);
			font-size: 0.82rem;
			font-weight: 800;
			letter-spacing: 0.04em;
		}

		.login-links {
			display: flex;
			flex-wrap: wrap;
			gap: 0.65rem;
		}

		.login-link {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 0.62rem 0.9rem;
			border-radius: var(--radius-pill);
			background: var(--bg-tertiary);
			border: 1px solid var(--border);
			color: var(--text-secondary);
		}

		.login-link:hover {
			color: var(--text);
			background: var(--surface-elevated);
			border-color: var(--border-strong);
		}

		.error {
			padding: 0.95rem 1rem;
			border-radius: 24px;
			border: 1px solid rgba(220, 38, 38, 0.18);
			background: rgba(220, 38, 38, 0.1);
			color: var(--danger);
			line-height: 1.75;
		}

		@media (max-width: 720px) {
			body {
				padding: 0.75rem;
			}

			.login-shell {
				width: min(100vw - 1rem, 100%);
			}

			.login-card {
				border-radius: 28px;
			}

			.login-card {
				padding: 1rem;
			}

			.login-card-inner {
				padding: 1.15rem;
			}
		}
	</style>
</head>
<body>
	<div class="login-shell">
		<div class="login-hero">主页同款后台</div>
		<section class="login-card">
			<div class="login-card-inner">
				<div class="login-card-header">
					<h2>后台登录</h2>
					<p class="login-hint">仅支持 GitHub OAuth 登录。</p>
				</div>
				${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
				<div class="login-notice">
					<strong>允许访问账号：</strong>${escapeHtml(githubLogin || "未配置")}
				</div>
				<a
					href="/api/auth/github"
					class="oauth-button"
					aria-disabled="${oauthEnabled ? "false" : "true"}"
				>
					<span class="oauth-mark">GH</span>
					<span>使用 GitHub OAuth 登录</span>
				</a>
				<div class="login-links">
					<a href="/" class="login-link">返回前台</a>
				</div>
			</div>
		</section>
	</div>
</body>
</html>`;
}
