import 'dotenv/config';
import express from 'express';
import path from 'path';
import { router } from './api/routes';
import { startWorker } from './worker/processor';
import { log } from './lib/logger';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logger
app.use((req, _res, next) => {
  log.info({ method: req.method, url: req.url }, 'http.request');
  next();
});

app.use('/api', router);

// Serve dashboard at root
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  log.info({ port: PORT }, 'server.started');
  startWorker();
});
