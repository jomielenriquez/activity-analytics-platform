import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'ADMIN_API_KEY'] as const;

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}. Check backend/.env against .env.example.`,
    );
    process.exit(1);
  }
}

validateEnv();

// Imported only after validateEnv() succeeds: PrismaClient reads DATABASE_URL
// at construction time and would otherwise throw its own, less clear, error
// before we get a chance to report ours.
import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { devicesRouter } from './routes/devices';

const app = express();
app.use(express.json());

app.use('/api/v1/devices', devicesRouter);

// Registered last so it catches errors from every route mounted above.
app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
