/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hatly: {
          orange: '#FF7A1A',
          orangeDark: '#E0650A',
        },
      },
    },
  },
  plugins: [],
};
