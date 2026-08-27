/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#0a0f1a",
          panel: "#101826",
          accent: "#22d3ee",
          danger: "#c96e4e",
        },
      },
    },
  },
  plugins: [],
};
