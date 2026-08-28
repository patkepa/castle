import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".vite/**",
      "dist/**",
      "native/target/**",
      "node_modules/**",
      "public/generated/**",
      "src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "no-regex-spaces": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["src/components/graph/ForceGraphCanvas.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
    },
  },
);
