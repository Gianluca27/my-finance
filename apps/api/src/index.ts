import { createApp } from './app';
import { config } from './config';
import { scheduleDigestsJob } from './jobs/digests';
import { schedulePricesJob } from './jobs/prices';
import { scheduleRemindersJob } from './jobs/reminders';

const app = createApp();

app.listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
  scheduleRemindersJob();
  scheduleDigestsJob();
  schedulePricesJob();
});
