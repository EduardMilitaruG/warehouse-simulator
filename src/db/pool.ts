import { Pool } from 'pg';
import 'dotenv/config';

export const pool = new Pool({
  host:     process.env.PGHOST     ?? 'localhost',
  port:     Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'warehouse',
  user:     process.env.PGUSER     ?? 'warehouse',
  password: process.env.PGPASSWORD ?? 'warehouse',
  max: 10,
});
