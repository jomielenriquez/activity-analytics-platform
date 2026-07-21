import express from 'express';
import { errorHandler } from './middleware/errorHandler';
import { devicesRouter } from './routes/devices';
import { eventsRouter } from './routes/events';

export const app = express();
app.use(express.json());

app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/events', eventsRouter);

// Registered last so it catches errors from every route mounted above.
app.use(errorHandler);
