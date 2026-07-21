import dotenv from 'dotenv';

// Runs before any test file's modules are evaluated (via Vitest's
// `setupFiles`), so DATABASE_URL is in process.env before ../src/app (and
// the PrismaClient it pulls in transitively) is ever imported.
dotenv.config();
