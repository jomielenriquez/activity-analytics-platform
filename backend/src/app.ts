import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { devicesRouter } from './routes/devices';
import { eventsRouter } from './routes/events';
import { statsRouter } from './routes/stats';
import { activityRouter } from './routes/activity';

export const app = express();
app.use(express.json());

app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/api/v1/activity', activityRouter);

// Registered last so it catches errors from every route mounted above.
app.use(errorHandler);
