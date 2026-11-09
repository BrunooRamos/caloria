// Configuración de ESLint compartida por app, front-service y back-service.
// Las dependencias viven en el package.json de la raíz: correr `npm install` acá primero.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "app/.expo/",
    "app/web-build/",
    "app/ios/",
    "app/android/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "smart"],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["front-service/**/*.ts", "back-service/**/*.ts", "shared/**/*.ts", "**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  // El SDK del proveedor de pagos solo se usa detrás de services/billing (cambiar de proveedor
  // toca solo ese módulo).
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["back-service/src/services/billing/stripe.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(stripe|@stripe/.+)(/.*)?$",
              message:
                "El SDK de pagos solo se importa en back-service/src/services/billing/stripe.ts.",
            },
          ],
        },
      ],
    },
  },
  // Archivos de config en CommonJS (metro.config.js, babel.config.js, app.config.js, ...).
  {
    files: ["**/*.{js,cjs}"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  // Siempre al final: apaga las reglas de estilo que maneja Prettier.
  prettier,
]);
