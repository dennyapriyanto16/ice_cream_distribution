/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ice: '#eff9ff',
        frost: '#d9f1fb',
        navy: '#14324b',
        ocean: '#287ca5',
      },
    },
  },
  plugins: [],
};
