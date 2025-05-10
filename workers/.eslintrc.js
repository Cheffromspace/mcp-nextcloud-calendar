module.exports = {
  extends: '../eslint.config.js',
  rules: {
    'no-undef': 'off',
    '@typescript-eslint/no-unused-vars': 'off'
  },
  globals: {
    Request: 'readonly',
    Response: 'readonly',
    URL: 'readonly'
  }
};