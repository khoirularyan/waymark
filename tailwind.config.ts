import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#E85D3F",
        ink: "#171717",
      },
    },
  },
  plugins: [],
} satisfies Config;
