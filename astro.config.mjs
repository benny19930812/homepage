import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://benny19930812.github.io',
  base: '/homepage',
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
