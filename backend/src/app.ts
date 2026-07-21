import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { devicesRouter } from './routes/devices';
import { eventsRouter } from './routes/events';
import { statsRouter } from './routes/stats';
import { activityRouter } from './routes/activity';

export const app = express();

// Open CORS (all origins): the dashboard is a browser SPA on a different
// origin/port than this API, so without this every request is blocked by
// the browser before it even reaches auth. Permissive origin is fine here
// specifically because auth is a Bearer token in a header, not a cookie —
// the real security boundary is the API key (requireDeviceAuth/
// requireAdminAuth), not which origin asked; CORS's cookie-credential
// restrictions (the case a wildcard origin would actually weaken) don't
// apply to header-based auth.
app.use(cors());

app.use(express.json());

app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/api/v1/activity', activityRouter);

// Registered last so it catches errors from every route mounted above.
app.use(errorHandler);
