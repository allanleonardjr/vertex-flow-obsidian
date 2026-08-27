import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// testing.md §11: Vitest is scoped to pure core domain logic only.
		// src/obsidian/** and src/ui/** are deliberately out of scope.
		include: ["tests/unit/**/*.test.ts"],
		coverage: {
			include: ["src/core/**"],
		},
	},
});
