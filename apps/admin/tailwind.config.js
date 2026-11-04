/** Своя гама календаря: sky на темному slate-тлі. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#0ea5e9', dark: '#0284c7', light: '#7dd3fc' } },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
