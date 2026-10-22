/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: process.env.DARK_MODE ? process.env.DARK_MODE : 'media',
  content: [
    './index.js',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  important: 'html',
  safelist: [
    {
      pattern:
        /(bg|border|text|stroke|fill)-(foreground|card|popover|muted|destructive|border|input|ring|primary|secondary|background|accent|warning|skeleton)(\/\d+)?$/,
    },
    {
      pattern:
        /(bg|border|text|stroke|fill)-(card|popover|muted|primary|secondary|accent)-(foreground)(\/\d+)?$/,
    },
  ],
  theme: {
    extend: {
      colors: {
        foreground: 'rgb(var(--foreground)/<alpha-value>)',
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
          foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
        },
        warning: 'rgb(var(--warning)/<alpha-value>)',
        skeleton: 'rgb(var(--skeleton)/<alpha-value>)',
        border: 'rgb(var(--border)/<alpha-value>)',
        input: 'rgb(var(--input)/<alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',

        primary: {
          DEFAULT: 'rgb(var(--primary)/<alpha-value>)',
          foreground: 'rgb(var(--primary-foreground)/<alpha-value>)',
        },

        secondary: {
          DEFAULT: 'rgb(var(--secondary)/<alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground)/<alpha-value>)',
        },

        background: {
          DEFAULT: 'rgb(var(--background)/<alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent)/<alpha-value>)',
          foreground: 'rgb(var(--accent-foreground)/<alpha-value>)',
        },
      },
      fontFamily: {
        heading: undefined,
        body: 'var(--font-sans)',
        mono: 'var(--font-mono)',
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
        inter: ['var(--font-inter)'],
        georgia: ['Georgia'],
        melno: ['Melno'],
        andika: [
          'Andika_400Regular',
          'Andika_400Regular_Italic',
          'Andika_700Bold',
          'Andika_700Bold_Italic',
        ],
        outfit: [
          'Outfit_400Regular',
          'Outfit_500Medium',
          'Outfit_600SemiBold',
          'Outfit_700Bold',
          'Outfit_800ExtraBold',
          'Outfit_900Black',
        ],
      },
      fontWeight: {
        extrablack: '950',
      },
      fontSize: {
        '2xs': '10px',
      },
    },
  },
};
