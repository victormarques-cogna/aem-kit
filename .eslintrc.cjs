module.exports = {
  root: true,
  extends: ['airbnb-base'],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'import/extensions': ['error', 'always'],
    'import/no-unresolved': 'off',
    'no-console': 'off',
    'max-len': ['error', { code: 140 }],
  },
};
