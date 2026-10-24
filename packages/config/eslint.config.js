import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/drizzle/meta/**',
      '**/.superpowers/**',
      // Vendored agent skills and their generated artifacts.
      '**/.opencode/**',
      '**/.impeccable/**',
      // Throwaway UI preview spike, and any build output.
      'preview/**',
      '**/bundle.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // A CLI script exists to print to the terminal.
    files: ['apps/*/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Expo and Babel config files are CommonJS by design.
    files: ['apps/customer/metro.config.js', 'apps/customer/babel.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
