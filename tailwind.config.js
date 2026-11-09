/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'arc-accent': c('accent'),
        'arc-success': c('success'),
        'arc-danger': c('danger'),
        'arc-warn': c('warn'),
        'arc-violet': c('violet'),
        'arc-blue': c('blue'),
        'arc-cyan': c('cyan'),
        'arc-amber': c('amber'),
        'arc-pink': c('pink'),
      },
    },
  },
  plugins: [],
}

