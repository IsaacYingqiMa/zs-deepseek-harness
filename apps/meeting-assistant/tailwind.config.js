/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        boss: '#f59e0b',
        pm: '#3b82f6',
        dev: '#10b981',
        unknown: '#6b7280',
      },
    },
  },
  plugins: [],
};