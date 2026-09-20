import cors from 'cors';
import express from 'express';
import { databaseConfig, isDatabaseConfigured } from './config/database.js';
import { runtimeConfig } from './config/runtime.js';
import { xLayerTestnet } from './config/xlayer.js';
import { createInvoice } from './invoices/service.js';
import { reconcileInvoicePayment } from './invoices/settlement.js';
import {
  createInvoiceRepository,
  DatabaseNotConfiguredError,
  InvoicePersistenceError,
} from './invoices/repository.js';
import type { InvoiceRepository } from './invoices/types.js';
import {
  InvoiceValidationError,
  validateInvoiceId,
  validateMerchantAddress,
  validateTransactionHash,
} from './invoices/validation.js';
import { createTestnetSettlementAdapter } from './settlement/testnet.js';
import {
  InvoiceNotPayableError,
  SettlementError,
  SettlementNotConfiguredError,
} from './settlement/types.js';
import type { SettlementAdapter } from './settlement/types.js';

export function createApp(
  invoiceRepository: InvoiceRepository = createInvoiceRepository(),
  settlementAdapter: SettlementAdapter = createTestnetSettlementAdapter(),
) {
  const app = express();

  app.use(
    cors({
      origin: runtimeConfig.corsOrigin,
    }),
  );
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({
      service: 'PortPay backend',
      status: 'ok',
      phase: 'Phase 3 — Core Settlement',
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

  app.post('/api/invoices', async (request, response, next) => {
    try {
      const invoice = await createInvoice(invoiceRepository, runtimeConfig.publicAppUrl, request.body);
      response.status(201).json({ invoice });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/invoices', async (request, response, next) => {
    try {
      const merchantAddress = validateMerchantAddress(request.query.merchantAddress);
      const invoices = await invoiceRepository.listByMerchant(merchantAddress);
      response.json({ invoices });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/invoices/:invoiceId', async (request, response, next) => {
    try {
      const invoiceId = validateInvoiceId(request.params.invoiceId);
      const invoice = await invoiceRepository.findById(invoiceId);
      if (!invoice) {
        response.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      response.json({ invoice });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/invoices/:invoiceId/quote', async (request, response, next) => {
    try {
      const invoiceId = validateInvoiceId(request.params.invoiceId);
      const invoice = await invoiceRepository.findById(invoiceId);
      if (!invoice) {
        response.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      const quote = await settlementAdapter.createQuote(invoice, request.body?.buyerAddress);
      response.json({ quote });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/invoices/:invoiceId/reconcile', async (request, response, next) => {
    try {
      const invoiceId = validateInvoiceId(request.params.invoiceId);
      const invoice = await invoiceRepository.findById(invoiceId);
      if (!invoice) {
        response.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      const updatedInvoice = await reconcileInvoicePayment(
        invoiceRepository,
        settlementAdapter,
        invoice,
        {
          txHash: validateTransactionHash(request.body?.txHash),
          buyerAddress: validateMerchantAddress(request.body?.buyerAddress) as `0x${string}`,
        },
      );
      response.json({ invoice: updatedInvoice });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof InvoiceValidationError) {
      response.status(400).json({ error: error.message, code: error.code });
      return;
    }

    if (error instanceof DatabaseNotConfiguredError) {
      response.status(503).json({ error: 'Invoice storage is not configured yet.', code: error.code });
      return;
    }

    if (error instanceof InvoicePersistenceError) {
      response.status(503).json({ error: 'Invoice storage is temporarily unavailable.', code: error.code });
      return;
    }

    if (error instanceof InvoiceNotPayableError) {
      response.status(409).json({ error: error.message, code: error.code });
      return;
    }

    if (error instanceof SettlementNotConfiguredError) {
      response.status(503).json({ error: error.message, code: error.code });
      return;
    }

    if (error instanceof SettlementError) {
      response.status(error.code === 'invalid_settlement_quote' ? 422 : 502).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    console.error('Unhandled PortPay backend error', error);
    response.status(500).json({ error: 'Unexpected backend error.' });
  });

  return app;
}

export const app = createApp();
