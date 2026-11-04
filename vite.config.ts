import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * Dev-only endpoint for `__generatePresetThumbnails()` (OnboardingDialog.tsx): the browser renders
 * each preset and POSTs the WebP here, written to public/presets/<id>.webp for the gallery.
 */
function presetThumbnailWriter(): Plugin {
  const dir = path.resolve(__dirname, 'public/presets');
  return {
    name: 'preset-thumbnail-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__preset-thumbnails/', (req, res) => {
        const id = (req.url ?? '').replace(/^\//, '');
        if (req.method !== 'POST' || !/^[a-z0-9_]+$/.test(id)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          fs.mkdirSync(dir, {recursive: true});
          fs.writeFileSync(path.join(dir, `${id}.webp`), Buffer.concat(chunks));
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig(() => {
  return {
    // Relative asset URLs so the build works under GitHub Pages' /<repo>/ sub-path.
    base: './',
    plugins: [react(), tailwindcss(), presetThumbnailWriter()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
