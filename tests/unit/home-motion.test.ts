import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("首页灵动交互保护喵", () => {
	test("基础布局会加载首页交互脚本喵", async () => {
		const baseLayoutSource = await readFile("src/layouts/Base.astro", "utf8");

		assert.match(baseLayoutSource, /home-motion\.js/u);
	});

	test("首页会提供景深 Hero 和 3D 胶囊结构喵", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		assert.match(homePageSource, /data-hero-depth/u);
		assert.match(homePageSource, /data-tilt-card/u);
		assert.match(homePageSource, /hero-signal-card/u);
		assert.match(homePageSource, /hero-aura-primary/u);
	});

	test("首页交互脚本会在切页后重新初始化并驱动鼠标联动变量喵", async () => {
		const homeMotionSource = await readFile("public/home-motion.js", "utf8");

		assert.match(homeMotionSource, /astro:page-load/u);
		assert.match(homeMotionSource, /astro:before-swap/u);
		assert.match(homeMotionSource, /--hero-pointer-x/u);
		assert.match(homeMotionSource, /--tilt-rotate-x/u);
		assert.match(homeMotionSource, /pointermove/u);
	});
});
