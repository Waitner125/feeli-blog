(function () {
	const HERO_SELECTOR = "[data-hero-depth]";
	const TILT_SELECTOR = "[data-tilt-card]";
	let disposeHomeMotion = () => {};

	const prefersReducedMotion = () =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const resetHeroState = (hero) => {
		hero.style.setProperty("--hero-pointer-x", "0");
		hero.style.setProperty("--hero-pointer-y", "0");
		hero.style.setProperty("--hero-scroll-shift", "0px");
	};

	const attachHeroDepth = (hero, disposers) => {
		let frame = 0;
		let pointerX = 0;
		let pointerY = 0;
		let scrollShift = 0;

		const render = () => {
			frame = 0;
			hero.style.setProperty("--hero-pointer-x", pointerX.toFixed(3));
			hero.style.setProperty("--hero-pointer-y", pointerY.toFixed(3));
			hero.style.setProperty("--hero-scroll-shift", `${scrollShift.toFixed(1)}px`);
		};

		const requestRender = () => {
			if (frame) {
				return;
			}

			frame = window.requestAnimationFrame(render);
		};

		const updateScrollShift = () => {
			scrollShift = Math.min(180, Math.max(0, window.scrollY));
			requestRender();
		};

		const handlePointerMove = (event) => {
			const rect = hero.getBoundingClientRect();

			if (!rect.width || !rect.height) {
				return;
			}

			const nextX = (event.clientX - rect.left) / rect.width - 0.5;
			const nextY = (event.clientY - rect.top) / rect.height - 0.5;

			pointerX = nextX * 2;
			pointerY = nextY * 2;
			requestRender();
		};

		const handlePointerLeave = () => {
			pointerX = 0;
			pointerY = 0;
			requestRender();
		};

		resetHeroState(hero);
		updateScrollShift();
		hero.addEventListener("pointermove", handlePointerMove);
		hero.addEventListener("pointerleave", handlePointerLeave);
		window.addEventListener("scroll", updateScrollShift, { passive: true });
		window.addEventListener("resize", updateScrollShift, { passive: true });
		requestRender();

		disposers.push(() => {
			if (frame) {
				window.cancelAnimationFrame(frame);
			}

			hero.removeEventListener("pointermove", handlePointerMove);
			hero.removeEventListener("pointerleave", handlePointerLeave);
			window.removeEventListener("scroll", updateScrollShift);
			window.removeEventListener("resize", updateScrollShift);
			resetHeroState(hero);
		});
	};

	const resetTiltState = (card) => {
		card.style.setProperty("--tilt-rotate-x", "0deg");
		card.style.setProperty("--tilt-rotate-y", "0deg");
		card.style.setProperty("--tilt-shift-x", "0");
		card.style.setProperty("--tilt-shift-y", "0");
	};

	const attachTiltCard = (card, disposers) => {
		let frame = 0;
		let rotateX = 0;
		let rotateY = 0;
		let shiftX = 0;
		let shiftY = 0;

		const render = () => {
			frame = 0;
			card.style.setProperty("--tilt-rotate-x", `${rotateX.toFixed(2)}deg`);
			card.style.setProperty("--tilt-rotate-y", `${rotateY.toFixed(2)}deg`);
			card.style.setProperty("--tilt-shift-x", shiftX.toFixed(3));
			card.style.setProperty("--tilt-shift-y", shiftY.toFixed(3));
		};

		const requestRender = () => {
			if (frame) {
				return;
			}

			frame = window.requestAnimationFrame(render);
		};

		const handlePointerMove = (event) => {
			const rect = card.getBoundingClientRect();

			if (!rect.width || !rect.height) {
				return;
			}

			const normalizedX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
			const normalizedY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;

			rotateY = normalizedX * 7;
			rotateX = normalizedY * -7;
			shiftX = normalizedX * 1.4;
			shiftY = normalizedY * 1.2;
			requestRender();
		};

		const handlePointerLeave = () => {
			rotateX = 0;
			rotateY = 0;
			shiftX = 0;
			shiftY = 0;
			requestRender();
		};

		resetTiltState(card);
		card.addEventListener("pointermove", handlePointerMove);
		card.addEventListener("pointerleave", handlePointerLeave);
		requestRender();

		disposers.push(() => {
			if (frame) {
				window.cancelAnimationFrame(frame);
			}

			card.removeEventListener("pointermove", handlePointerMove);
			card.removeEventListener("pointerleave", handlePointerLeave);
			resetTiltState(card);
		});
	};

	const initHomeMotion = () => {
		disposeHomeMotion();

		if (prefersReducedMotion()) {
			return;
		}

		const disposers = [];
		const hero = document.querySelector(HERO_SELECTOR);
		const tiltCards = document.querySelectorAll(TILT_SELECTOR);

		if (hero instanceof HTMLElement) {
			attachHeroDepth(hero, disposers);
		}

		for (const card of tiltCards) {
			if (card instanceof HTMLElement) {
				attachTiltCard(card, disposers);
			}
		}

		disposeHomeMotion = () => {
			for (const dispose of disposers.splice(0)) {
				dispose();
			}
		};
	};

	document.addEventListener("astro:before-swap", () => disposeHomeMotion());
	document.addEventListener("astro:page-load", initHomeMotion);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initHomeMotion, { once: true });
	} else {
		initHomeMotion();
	}
})();
