import antfu from "@antfu/eslint-config";

export default antfu({
  ignores: [
    "dist/**",
    "fixtures/**",
    "data/**",
  ],
  react: true,
  markdown: false,
  stylistic: {
    semi: true,
    quotes: "double",
  },
  rules: {
    "no-console": "off",
    "node/prefer-global/process": "off",
    // New in @antfu/eslint-config 10: it would break 1,372 objects and ternaries across 78 files onto
    // separate lines. The code here is written to be read a statement to a line, so it stays as it is.
    "antfu/reasonable-newline": "off",
  },
});
