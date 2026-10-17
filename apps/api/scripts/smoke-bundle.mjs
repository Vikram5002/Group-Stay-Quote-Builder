// Loads the bundled API handler and calls GET /health with an HTTP API v2 event.
// Run after `npm run bundle`: node scripts/smoke-bundle.mjs
process.env.APP_VERSION ??= 'bundle-smoke';
const apiUrl = new URL('../dist-lambda/api/index.mjs', import.meta.url);
const workerUrl = new URL('../dist-lambda/worker/index.mjs', import.meta.url);
const { handler } = await import(apiUrl.href);
const res = await handler(
  {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/health',
    rawQueryString: '',
    headers: { host: 'local' },
    requestContext: {
      http: { method: 'GET', path: '/health', sourceIp: '127.0.0.1' },
      requestId: 'smoke',
      stage: '$default',
    },
  },
  { functionName: 'smoke', awsRequestId: 'smoke', getRemainingTimeInMillis: () => 3000 },
  () => {},
);
const body = JSON.parse(res.body);
if (res.statusCode !== 200 || body.status !== 'ok') {
  console.error('bundle smoke failed', res);
  process.exit(1);
}
console.log(`bundle ok: ${res.statusCode} ${JSON.stringify(body)}`);

const worker = await import(workerUrl.href);
if (typeof worker.handler !== 'function') {
  console.error('worker bundle has no handler');
  process.exit(1);
}
console.log('worker bundle ok: handler exported');
