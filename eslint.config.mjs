import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
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
]);