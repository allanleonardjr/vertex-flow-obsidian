import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*", "src/core/help-generated.d.ts"],
        },
      },
      globals: {
        // The React UMD global from `@types/react`; references are type-only.
        React: "readonly",
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        { brands: ["Vertex Flow"], enforceCamelCaseLower: true },
      ],
    },
  },
  {
    // Unit tests run under Vitest in Node, not in Obsidian: Node built-ins are
    // expected there, and the plugin's mobile guard doesn't apply.
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
]);