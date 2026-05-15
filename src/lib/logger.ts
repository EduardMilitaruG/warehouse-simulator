import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const streams: pino.StreamEntry[] = [
  { stream: process.stdout },
  {
    stream: pino.destination({
      dest: path.join(logsDir, 'warehouse.log'),
      sync: false,
    }),
  },
];

export const log = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'warehouse-sim' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams)
);
