// Writes docs/openapi.json from the Zod contract. Run: npm run openapi
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../src/index.js';

const target = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
writeFileSync(target, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n', 'utf8');
console.log(`wrote ${target}`);
