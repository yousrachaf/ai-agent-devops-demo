module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    // Enforce structured error handling — no swallowed errors
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'error', // Use pino logger, never console.log
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: ['error', 'always'],
  },
};
