import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express from 'express';
import { router } from './routes';

// Load apps/api/.env without dotenv package
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    product: 'EVSaathi',
    version: '0.3.0-phase3',
    docs: '/v1/health',
    note: 'Phase 3 Integrations + AI — demo OEM/operator stubs, explainable AI, no LIVE fabrication, no AI actuators',
  });
});

app.use('/v1', router);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Unexpected server error', details: {} },
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`EVSaathi API listening on http://0.0.0.0:${port}`);
  console.log('Phase 3: adapters + consent + AI (actuator deny). OTP stub: 123456');
  console.log(
    process.env.FCM_SERVER_KEY
      ? 'FCM_SERVER_KEY present — push + inbox'
      : 'FCM keys missing — in-app inbox only',
  );
});