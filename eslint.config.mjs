import next from "eslint-config-next";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", ".data/**"] },
  {
    files: ["src/lib/**/*.ts", "src/db/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
];

export default config;
