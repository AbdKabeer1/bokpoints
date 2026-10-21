import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);

const app = await buildApp({ db, logger: true });

app.addHook('onClose', async () => {
  await pool.end();
});

await app.listen({ port: env.PORT, host: env.HOST });
