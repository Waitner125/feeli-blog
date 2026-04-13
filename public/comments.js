(function () {
	const PANEL_SELECTOR = "[data-comments-panel]";
	const TOGGLE_SELECTOR = "[data-comments-toggle]";
	const BODY_SELECTOR = "[data-comments-body]";
	const TWIKOO_CONTAINER_ID = "twikoo-comments";
	let disposeComments = () => {};

	// 加载 Twikoo 脚本（使用 npmmirror 镜像）
	const loadTwikoo = () => {
		if (window.twikoo) return Promise.resolve(window.twikoo);
		return new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "https://registry.npmmirror.com/twikoo/1.7.7/files/dist/twikoo.min.js";
			script.crossOrigin = "anonymous";
			script.onload = () => resolve(window.twikoo);
			script.onerror = () => reject(new Error("Twikoo 加载失败"));
			document.head.appendChild(script);
		});
	};

	// 初始化 Twikoo
	const initTwikoo = (panel) => {
		if (panel.dataset.commentsLoaded === "true") return;

		const container = document.getElementById(TWIKOO_CONTAINER_ID);
		if (!container) {
			console.warn("Twikoo 容器 #" + TWIKOO_CONTAINER_ID + " 未找到");
			return;
		}

		const envId = panel.dataset.commentsEnvId;
		const region = panel.dataset.commentsRegion || "ap-shanghai";
		const lang = panel.dataset.commentsLang || "zh-CN";

		if (!envId) {
			console.error("缺少 envId，无法初始化 Twikoo");
			return;
		}

		loadTwikoo()
			.then((twikoo) => {
				twikoo.init({
					envId,
					region,
					el: "#" + TWIKOO_CONTAINER_ID,
					lang,
				});
				panel.dataset.commentsLoaded = "true";
			})
			.catch((err) => console.error("Twikoo 初始化失败:", err));
	};

	const setExpandedState = (panel, isOpen) => {
		const toggle = panel.querySelector(TOGGLE_SELECTOR);
		const body = panel.querySelector(BODY_SELECTOR);

		if (!(toggle instanceof HTMLButtonElement) || !(body instanceof HTMLElement)) return;

		panel.classList.toggle("is-open", isOpen);
		toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
		body.hidden = !isOpen;
	};

	const initComments = () => {
		disposeComments();

		const panel = document.querySelector(PANEL_SELECTOR);
		if (!(panel instanceof HTMLElement)) return;

		const isReady = panel.dataset.commentsReady === "true";
		const toggle = panel.querySelector(TOGGLE_SELECTOR);
		if (!(toggle instanceof HTMLButtonElement)) return;

		const handleToggle = () => {
			const isOpen = !panel.classList.contains("is-open");
			setExpandedState(panel, isOpen);

			if (isOpen && isReady) {
				initTwikoo(panel);
			}
		};

		// 初始化状态为关闭
		setExpandedState(panel, false);
		toggle.addEventListener("click", handleToggle);

		disposeComments = () => {
			toggle.removeEventListener("click", handleToggle);
		};
	};

	document.addEventListener("astro:before-swap", () => disposeComments());
	document.addEventListener("astro:page-load", initComments);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initComments, { once: true });
	} else {
		initComments();
	}
})();
