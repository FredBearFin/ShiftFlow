export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Mirrors the CSS custom properties declared in src/index.css.
      // Every colour the app renders has exactly one token name; raw hex
      // literals and default-palette slate-*/indigo-* utilities are banned
      // in src/ (see scripts/README-codemod-tokens.md).
      colors: {
        canvas: 'var(--canvas)',
        card: 'var(--card)',
        surface: {
          DEFAULT: 'var(--surface)',
          subtle: 'var(--surface-subtle)',
          sunken: 'var(--surface-sunken)',
          'sunken-strong': 'var(--surface-sunken-strong)',
        },
        border: {
          DEFAULT: 'var(--border)',
          subtle: 'var(--border-subtle)',
          control: 'var(--border-control)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          strong: 'var(--ink-strong)',
          soft: 'var(--ink-soft)',
        },
        muted: 'var(--muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          soft: 'var(--accent-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          ink: 'var(--warning-ink)',
          soft: 'var(--warning-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          strong: 'var(--danger-strong)',
          soft: 'var(--danger-soft)',
        },
        // Ordered status ramp: ok -> watch -> risk.
        status: {
          ok: 'var(--status-ok)',
          'ok-soft': 'var(--status-ok-soft)',
          'ok-ink': 'var(--status-ok-ink)',
          watch: 'var(--status-watch)',
          'watch-soft': 'var(--status-watch-soft)',
          'watch-ink': 'var(--status-watch-ink)',
          risk: 'var(--status-risk)',
          'risk-soft': 'var(--status-risk-soft)',
          'risk-ink': 'var(--status-risk-ink)',
        },
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
