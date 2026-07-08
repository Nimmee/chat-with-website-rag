import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c1917",
        paper: "#faf9f7",
        accent: "#2563eb"
      }
    }
  },
  plugins: []
};
export default config;
