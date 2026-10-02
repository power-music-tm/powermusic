/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-primary': 'var(--color-brand-primary)',
        'brand-secondary': 'var(--color-brand-secondary)',
        'brand-secondary-muted': 'var(--color-brand-secondary-muted)',
        'brand-accent': 'var(--color-brand-accent)',
        'surface-bg': 'var(--color-surface-bg)',
        'surface-card': 'var(--color-surface-card)',
        'surface-sidebar': 'var(--color-surface-sidebar)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'border-default': 'var(--color-border-default)',
      },
    },
  },
  plugins: [],
}
