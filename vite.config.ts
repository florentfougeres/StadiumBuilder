import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * Dev-only endpoint for `__generateThumbnails()` (src/editor/thumbnails.ts): the browser renders
 * each preset or option and POSTs the WebP here, written to public/<dir>/<id>.webp.
 */
function thumbnailWriter(): Plugin {
  return {
    name: 'thumbnail-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__thumbnails/', (req, res) => {
        const match = /^\/(presets|shapes|roofs|envelopes)\/([a-z0-9_]+)$/.exec(req.url ?? '');
        if (req.method !== 'POST' || !match) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = path.resolve(__dirname, 'public', match[1]);
          fs.mkdirSync(dir, {recursive: true});
          fs.writeFileSync(path.join(dir, `${match[2]}.webp`), Buffer.concat(chunks));
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
    plugins: [react(), tailwindcss(), thumbnailWriter()],
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
