module.exports = {
  env: {
    // commonjs: true, // Keep or remove based on whether you still have CommonJS files. For a full TS project, this might be false.
    node: true,
    jest: true,
    es6: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended' // Add TypeScript specific recommendations
  ],
  parser: '@typescript-eslint/parser', // Specify the TypeScript parser
  parserOptions: {
    ecmaVersion: 2021, // Or newer
    sourceType: 'module', // Allow for the use of imports
    project: './tsconfig.json', // Optional: Link to your tsconfig for type-aware linting
  },
  plugins: [
    '@typescript-eslint' // Add the TypeScript plugin
  ],
  rules: {
    // You can add or override rules here
    // e.g., "@typescript-eslint/explicit-function-return-type": "warn"
  },
};
