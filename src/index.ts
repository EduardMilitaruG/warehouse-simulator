import 'dotenv/config';
import { app } from './app';
import { startWorker } from './worker/processor';
import { log } from './lib/logger';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  log.info({ port: PORT }, 'server.started');
  startWorker();
});
