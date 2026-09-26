import esbuild from 'esbuild';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('production');
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const context = await esbuild.context({
  absWorkingDir: projectRoot,
  entryPoints: [path.join(projectRoot, 'src/main.ts')],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2021',
  outfile: path.join(projectRoot, 'main.js'),
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
