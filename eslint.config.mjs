import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'gui/node_modules/**', 'gui/dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // The tray widget's page runs in Electron's renderer, not Node.
    files: ['gui/renderer.mjs'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Electron preload scripts are CommonJS.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
