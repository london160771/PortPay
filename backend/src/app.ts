import cors from 'cors';
import express from 'express';
import { databaseConfig, isDatabaseConfigured } from './config/database.js';
import {
  findMerchantApiCredential,
  findMerchantCredentialByAddress,
  runtimeConfig,
} from './config/runtime.js';
import type { MerchantAuthConfig, MerchantCredential } from './config/runtime.js';
import { xLayerTestnet } from './config/xlayer.js';
import { createInvoice } from './invoices/service.js';
import { reconcileInvoicePayment } from './invoices/settlement.js';
import {
  createInvoiceRepository,
  DatabaseNotConfiguredError,
  InvoicePersistenceError,
} from './invoices/repository.js';
import type { Invoice, InvoiceRepository } from './invoices/types.js';
import {
  InvoiceValidationError,
  validateInvoiceId,
  validateMerchantAddress,
  validateSmartSpendMetadata,
  validateTransactionHash,
  validateWalletAddress,
} from './invoices/validation.js';
import { createTestnetSettlementAdapter } from './settlement/testnet.js';
import {
  InvoiceNotPayableError,
  SettlementError,
  SettlementNotConfiguredError,
} from './settlement/types.js';
import type { SettlementAdapter } from './settlement/types.js';
import { deliverPaymentConfirmedWebhook } from './integration/webhook.js';
import { createMainnetApprovalPreparationService } from './settlement/mainnetApprovalPreparation.js';
import type { MainnetApprovalPreparationService } from './settlement/mainnetApprovalPreparation.js';

type AppOptions = {
  merchantAuth?: MerchantAuthConfig;
  mainnetApprovalPreparation?: MainnetApprovalPreparationService;
  webhookDelivery?: (invoice: Invoice, credential: MerchantCredential) => Promise<void>;
};

type AuthenticatedRequest = express.Request & { merchantCredential?: MerchantCredential };

function merchantAuthMiddleware(config: MerchantAuthConfig): express.RequestHandler {
  return (request, response, next) => {
    const credential = findMerchantApiCredential(request.header('authorization'), config);
    if (!credential) {
      response.status(401).json({
        error: 'Merchant API authentication required.',
        code: 'merchant_auth_required',
      });
      return;
    }

    (request as AuthenticatedRequest).merchantCredential = credential;
    next();
  };
}

function integrationInvoice(invoice: Invoice) {
  return invoice;
}

function publicInvoice(invoice: Invoice): Omit<Invoice, 'externalOrderReference'> {
  const publicFields = { ...invoice };
  delete publicFields.externalOrderReference;
  return publicFields;
}

export function createApp(
  invoiceRepository: InvoiceRepository = createInvoiceRepository(),
  settlementAdapter: SettlementAdapter = createTestnetSettlementAdapter(),
  options: AppOptions = {},
) {
  const app = express();
  const merchantAuth = options.merchantAuth ?? runtimeConfig.merchantAuth;

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
      phase: 'Phase 7 — Polish/submission',
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
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const invoice = await createInvoice(invoiceRepository, runtimeConfig.publicAppUrl, {
        title: body.title,
        amountUsdt0: body.amountUsdt0,
        merchantAddress: body.merchantAddress,
      });
      response.status(201).json({ invoice: publicInvoice(invoice) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/invoices', async (request, response, next) => {
    try {
      const merchantAddress = validateMerchantAddress(request.query.merchantAddress);
      const invoices = await invoiceRepository.listByMerchant(merchantAddress);
      response.json({ invoices: invoices.map(publicInvoice) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/history/merchant', async (request, response, next) => {
    try {
      const merchantAddress = validateMerchantAddress(request.query.merchantAddress);
      const payments = await invoiceRepository.listPaidByMerchant(merchantAddress);
      response.json({ payments: payments.map(publicInvoice) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/history/buyer', async (request, response, next) => {
    try {
      const buyerAddress = validateWalletAddress(request.query.buyerAddress, 'Buyer wallet');
      const payments = await invoiceRepository.listPaidByBuyer(buyerAddress);
      response.json({ payments: payments.map(publicInvoice) });
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

      response.json({ invoice: publicInvoice(invoice) });
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

      const quote = await settlementAdapter.createQuote(
        invoice,
        request.body?.buyerAddress,
        request.body?.assetKey,
      );
      response.json({ quote });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/invoices/:invoiceId/mainnet/approval-preparation', async (request, response, next) => {
    let invoiceId: string;
    let invoice: Invoice | null;
    let buyerAddress: `0x${string}`;
    try {
      invoiceId = validateInvoiceId(request.params.invoiceId);
      invoice = await invoiceRepository.findById(invoiceId);
      buyerAddress = validateWalletAddress(request.body?.buyerAddress, 'Buyer wallet') as `0x${string}`;
    } catch (error) {
      next(error);
      return;
    }
    if (!invoice) {
      response.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (invoice.status !== 'pending') {
      response.status(409).json({ error: 'Only a pending invoice can be used to prepare a mainnet approval.' });
      return;
    }
    if (!options.mainnetApprovalPreparation) {
      response.status(503).json({ error: 'Mainnet approval preparation is not configured.' });
      return;
    }
    try {
      response.json(await options.mainnetApprovalPreparation(invoice, buyerAddress));
    } catch {
      response.status(503).json({ error: 'A safe mainnet approval preparation could not be produced. Check mainnet RPC, OKX, Builder Code, and Supabase configuration.' });
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
          buyerAddress: validateWalletAddress(request.body?.buyerAddress, 'Buyer wallet') as `0x${string}`,
          ...validateSmartSpendMetadata(request.body),
        },
      );
      const credential = findMerchantCredentialByAddress(updatedInvoice.merchantAddress, merchantAuth);
      if (credential?.webhookUrl && credential.webhookSecret) {
        const deliver = options.webhookDelivery ?? ((paidInvoice, paidCredential) =>
          deliverPaymentConfirmedWebhook(paidCredential, paidInvoice));
        void deliver(updatedInvoice, credential).catch((error: unknown) => {
          console.error('PortPay payment webhook delivery failed', error);
        });
      }
      response.json({ invoice: publicInvoice(updatedInvoice) });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/integration', merchantAuthMiddleware(merchantAuth));

  app.post('/api/integration/invoices', async (request, response, next) => {
    try {
      const credential = (request as AuthenticatedRequest).merchantCredential;
      if (!credential) {
        response.status(401).json({ error: 'Merchant API authentication required.', code: 'merchant_auth_required' });
        return;
      }
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const invoice = await createInvoice(invoiceRepository, runtimeConfig.publicAppUrl, {
        ...body,
        merchantAddress: credential.merchantAddress,
      });
      response.status(201).json({ invoice: integrationInvoice(invoice) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/integration/invoices/:invoiceId/status', async (request, response, next) => {
    try {
      const credential = (request as AuthenticatedRequest).merchantCredential;
      const invoiceId = validateInvoiceId(request.params.invoiceId);
      const invoice = await invoiceRepository.findById(invoiceId);
      if (!invoice || !credential || invoice.merchantAddress !== credential.merchantAddress) {
        response.status(404).json({ error: 'Invoice not found.' });
        return;
      }
      response.json({
        invoiceId: invoice.id,
        status: invoice.status,
        amountUsdt0: invoice.amountUsdt0,
        paymentUrl: invoice.paymentUrl,
        ...(invoice.externalOrderReference ? { externalOrderReference: invoice.externalOrderReference } : {}),
        ...(invoice.paymentTxHash ? { paymentTxHash: invoice.paymentTxHash } : {}),
        ...(invoice.paidAt ? { paidAt: invoice.paidAt } : {}),
      });
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

export const app = createApp(undefined, undefined, {
  mainnetApprovalPreparation: createMainnetApprovalPreparationService(),
});
