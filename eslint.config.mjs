import globals from 'globals';

// Catches what this codebase's module splits kept tripping over: names used but never
// imported (no-undef) and imports or values left behind (no-unused-vars).
const rules = {
  'no-undef': 'error',
  // `const { id, ...rest } = x` drops fields on purpose.
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
};

export default [
  { ignores: ['node_modules/', 'work/', 'outputs/', '.workroom/'] },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
    rules,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules,
  },
  // Check scripts pass callbacks to page.evaluate(), which run inside the app window.
  {
    files: ['scripts/checks/**', 'scripts/check-semantic-app.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
