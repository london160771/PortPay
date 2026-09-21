/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#09111f',
        cloud: '#f4f7fb',
        paper: '#fbfcfa',
        mint: '#baf3d2',
        electric: '#5c7cfa',
        coral: '#ff8a65',
      },
      boxShadow: {
        soft: '0 24px 70px rgba(9, 17, 31, 0.12)',
        panel: '0 16px 45px rgba(9, 17, 31, 0.08)',
      },
    },
  },
  plugins: [],
};
