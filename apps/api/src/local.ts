import { createApp } from './app.js';
import { log } from './log.js';

const port = Number(process.env['PORT'] ?? 3000);

createApp().listen(port, () => {
  log('info', 'api_listening', { url: `http://localhost:${port}` });
});
