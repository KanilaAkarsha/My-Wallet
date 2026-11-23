import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../database/connection.js';
import * as Models from '../database/models/index.js';

/** One-off: builds all declared indexes (run on each deploy in production, where autoIndex is off). */
await connectDatabase();
for (const [name, m] of Object.entries(Models)) {
  const model = m as { modelName?: string; syncIndexes?: () => Promise<unknown> };
  if (model?.modelName && model.syncIndexes) { await model.syncIndexes(); console.log('indexes synced:', name); }
}
await mongoose.disconnect();
