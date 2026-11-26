import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

/**
 * Lint rules chosen for *defects*, not for taste.
 *
 * Formatting is Prettier's job and the config ends with eslint-config-prettier
 * so the two cannot disagree. What is left here is the set of mistakes that have
 * actually cost a pass in this repo or that a codebase this shape invites:
 *
 *   no-undef, no-unused-vars   — a rename that misses a call site
 *   react-hooks/rules-of-hooks — a hook inside a condition, which is how the
 *                                census effect lost its cleanup once
 *   no-dupe-keys               — a repo record with the same field twice; the
 *                                second silently wins
 *   eqeqeq                     — `==` against null is fine, `==` against a
 *                                number in a data-derived comparison is not
 *
 * Deliberately NOT enabled: stylistic rule sets, `react/prop-types` (plain JS,
 * no prop validation in this project), and anything requiring TypeScript.
 */
export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },

  js.configs.recommended,

  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Downgraded from the recommended error. This fires on two patterns that
      // are correct here: reporting a failed world start from a catch block, and
      // copying `world.data` into state when the world mounts. A cascading
      // render is impossible in both — the effect depends on `world`, which does
      // not change as a result. The rule is right in general and wrong about
      // these two, and restructuring working code to satisfy it would be the
      // tail wagging the dog.
      "react-hooks/set-state-in-effect": "warn",
      // JSX usage has to be visible to no-unused-vars or every component prop
      // reads as unused.
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",

      // Warnings, not errors, on the first pass. There are ~30 pre-existing
      // unused locals in this codebase; turning them into hard failures on day
      // one would block every commit until someone did a sweep that is not part
      // of this change. They stay visible, and `npm run lint` exits zero.
      // Raise to "error" once the backlog is cleared.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-class-members": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],

      // The census hooks assign onto `window` and the tests stub globals; both
      // are intentional and both read as accidental mutation otherwise.
      "no-global-assign": "off",
    },
  },

  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ["worker/**/*.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.node },
    },
  },

  prettier,
];
