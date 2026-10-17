// Bundles the two Lambda handlers the way Track 3 deploys them (Node.js 24, arm64, ESM).
// Run: npm run bundle -w @c32/api   -> apps/api/dist-lambda/{api,worker}/index.mjs
import { build } from 'esbuild';
import { rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist-lambda`;
rmSync(out, { recursive: true, force: true });

for (const [name, entry] of [
  ['api', 'src/lambda.ts'],
  ['worker', 'src/worker.ts'],
]) {
  const outfile = `${out}/${name}/index.mjs`;
  await build({
    entryPoints: [`${root}${entry}`],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    // CommonJS dependencies (express, serverless-express) need require() inside ESM.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  console.log(`${name}: ${(statSync(outfile).size / 1024).toFixed(0)} KiB -> ${outfile}`);
}
