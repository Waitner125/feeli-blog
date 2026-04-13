export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
	comments: CommentConfig;
}

export interface CommentConfig {
  provider: "twikoo";
  envId: string;
  region?: string;
  lang?: string;
}

export const siteConfig: SiteConfig = {
	name: "临渊羡鱼的博客",
	url: "https://blog.994613.xyz",
	description: "",
	author: "临渊羡鱼",
	language: "zh-CN",
	comments: {
		provider: "twikoo",
		envId: "https://test.994613.xyz/",
		region: "ap-shanghai",
		lang: "zh-CN",
	},
};

export interface PaginationParams {
	page: number;
	limit: number;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export type PostStatus = "draft" | "published" | "scheduled";
