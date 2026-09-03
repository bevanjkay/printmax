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
  },
});
