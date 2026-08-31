import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps built asset URLs relative, so the same build works at a
// domain root (Netlify/Vercel) or under a subpath (GitHub Pages project site).
export default defineConfig({
  plugins: [react()],
  base: './',
});
