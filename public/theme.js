(function () {
	const root = document.documentElement;
	const NAV_CONDENSE_ENTER_Y = 56;
	const NAV_CONDENSE_EXIT_Y = 20;
	const ROUTE_TRANSITION_ORDER = [
		{
			order: 0,
			matches: (pathname) => pathname === "/",
		},
		{
			order: 1,
			matches: (pathname) =>
				pathname === "/blog" || pathname.startsWith("/blog/"),
		},
		{
			order: 2,
			matches: (pathname) => pathname === "/search",
		},
	];
	let isNavCondensed = root.hasAttribute("data-nav-condensed");
	let isRouteTransitioning = false;
	let syncFrame = 0;
	let pendingForceSync = false;

	const theme = localStorage.getItem("theme");
	if (theme === "dark" || theme === "light") {
		root.setAttribute("data-theme", theme);
	}

	const normalizeScrollY = (scrollY) =>
		Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;

	const getRouteTransitionOrder = (pathname) => {
		const matchedRoute = ROUTE_TRANSITION_ORDER.find((route) =>
			route.matches(pathname),
		);

		return matchedRoute?.order ?? null;
	};

	const getRouteTransitionDirection = (fromUrl, toUrl, fallbackDirection) => {
		if (fallbackDirection === "back") {
			return fallbackDirection;
		}

		const fromOrder = getRouteTransitionOrder(fromUrl.pathname);
		const toOrder = getRouteTransitionOrder(toUrl.pathname);

		if (fromOrder === null || toOrder === null || fromOrder === toOrder) {
			return fallbackDirection;
		}

		return toOrder > fromOrder ? "forward" : "back";
	};

	const getInitialNavCondensedState = (scrollY) =>
		normalizeScrollY(scrollY) >= NAV_CONDENSE_ENTER_Y;

	const getNextNavCondensedState = (scrollY) => {
		const normalizedScrollY = normalizeScrollY(scrollY);

		if (isNavCondensed) {
			return normalizedScrollY > NAV_CONDENSE_EXIT_Y;
		}

		return normalizedScrollY >= NAV_CONDENSE_ENTER_Y;
	};

	const applyNavState = (nextCondensed) => {
		if (nextCondensed === isNavCondensed) {
			return;
		}

		isNavCondensed = nextCondensed;
		root.toggleAttribute("data-nav-condensed", nextCondensed);
	};

	const syncRootAttributeToDocument = (name, nextDocument) => {
		const value = root.getAttribute(name);

		if (value === null) {
			nextDocument.documentElement.removeAttribute(name);
			return;
		}

		nextDocument.documentElement.setAttribute(name, value);
	};

	const syncNavState = ({ force = false } = {}) => {
		if (isRouteTransitioning) {
			return;
		}

		const nextCondensed = force
			? getInitialNavCondensedState(window.scrollY)
			: getNextNavCondensedState(window.scrollY);

		applyNavState(nextCondensed);
	};

	const requestNavSync = (force = false) => {
		pendingForceSync ||= force;

		if (syncFrame) {
			return;
		}

		syncFrame = window.requestAnimationFrame(() => {
			syncFrame = 0;
			const shouldForceSync = pendingForceSync;
			pendingForceSync = false;
			syncNavState({ force: shouldForceSync });
		});
	};

	syncNavState({ force: true });
	window.addEventListener("scroll", () => requestNavSync(), { passive: true });
	window.addEventListener("resize", () => requestNavSync(true), {
		passive: true,
	});
	document.addEventListener("astro:page-load", () => requestNavSync(true));
	document.addEventListener("astro:before-preparation", (event) => {
		event.direction = getRouteTransitionDirection(
			event.from,
			event.to,
			event.direction,
		);
	});
	document.addEventListener("astro:before-swap", (event) => {
		isRouteTransitioning = true;
		syncRootAttributeToDocument("data-theme", event.newDocument);
		event.newDocument.documentElement.toggleAttribute(
			"data-nav-condensed",
			isNavCondensed,
		);

		const unlockNavSync = () => {
			isRouteTransitioning = false;
			requestNavSync(true);
		};

		if (event.viewTransition?.finished) {
			event.viewTransition.finished.finally(() => {
				window.requestAnimationFrame(unlockNavSync);
			});
			return;
		}

		window.requestAnimationFrame(unlockNavSync);
	});

	document.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) {
			return;
		}

		const toggle = event.target.closest(".theme-toggle");
		if (!toggle) {
			return;
		}

		const current = root.getAttribute("data-theme");
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;

		const next =
			current === "dark" || (!current && prefersDark) ? "light" : "dark";

		root.setAttribute("data-theme", next);
		localStorage.setItem("theme", next);
	});
})();
