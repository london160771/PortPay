import cors from 'cors';
import express from 'express';
import { databaseConfig, isDatabaseConfigured } from './config/database.js';
import { xLayerTestnet } from './config/xlayer.js';

export const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
  }),
);
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    service: 'PortPay backend',
    status: 'ok',
    phase: 'Phase 1 — Wallet + Demo Assets',
    network: {
      name: xLayerTestnet.name,
      chainId: xLayerTestnet.chainId,
    },
    database: {
      provider: databaseConfig.provider,
      configured: isDatabaseConfigured,
    },
  });
});
