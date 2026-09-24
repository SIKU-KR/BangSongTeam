/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: {
    relative: true,
    files: ["../index.html", "../src/client/**/*.{js,ts,jsx,tsx}"],
  },
  theme: {
    extend: {
      aspectRatio: {
        "16/9": "16 / 9",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
