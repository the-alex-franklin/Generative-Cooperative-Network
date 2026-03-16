import { defineConfig, presetWebFonts, presetWind4 } from 'unocss'

export default defineConfig({
  presets: [
    presetWind4(),
    presetWebFonts({
      provider: 'google',
      fonts: {
        mono: 'JetBrains Mono:400,500',
      },
    }),
  ],
  theme: {
    animation: {
      keyframes: {
        'fade-in':
          '{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
        'blink': '{50%{opacity:0}}',
      },
      durations: {
        'fade-in': '0.25s',
        'blink': '1s',
      },
      timingFns: {
        'fade-in': 'ease-out',
        'blink': 'step-end',
      },
      counts: {
        'blink': 'infinite',
      },
    },
  },
})
