/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './static/js/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        cute: ['Gowun Dodum', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
