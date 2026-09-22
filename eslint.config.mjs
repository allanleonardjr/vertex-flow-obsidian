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
      // Obsidian strips the native dropdown arrow, so every dropdown goes
      // through the shared `Select` component, which draws its own.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use <Select> from src/ui/components/Select.tsx: bare <select>s render with no arrow in Obsidian.",
        },
      ],
    },
  },
  {
    // The one place a bare <select> is allowed: the component that wraps it.
    files: ["src/ui/components/Select.tsx"],
    rules: {
      "no-restricted-syntax": "off",
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