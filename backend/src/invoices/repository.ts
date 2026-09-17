import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { databaseConfig, isDatabaseConfigured } from '../config/database.js';
import type { Invoice, InvoiceRepository } from './types.js';

export class InvoicePersistenceError extends Error {
  readonly code: string = 'invoice_persistence_failed';

  constructor(message = 'Invoice persistence is unavailable.') {
    super(message);
    this.name = 'InvoicePersistenceError';
  }
}

export class DatabaseNotConfiguredError extends InvoicePersistenceError {
  readonly code = 'database_not_configured';

  constructor() {
    super('Supabase/Postgres is not configured.');
    this.name = 'DatabaseNotConfiguredError';
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly invoices = new Map<string, Invoice>();

  async create(invoice: Invoice): Promise<Invoice> {
    const stored = { ...invoice, id: invoice.id || randomUUID() };
    this.invoices.set(stored.id, stored);
    return stored;
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.invoices.get(id) ?? null;
  }

  async listByMerchant(merchantAddress: string): Promise<Invoice[]> {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.merchantAddress === merchantAddress)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

type InvoiceRow = {
  id: string;
  title: string;
  amount_usdt0: string | number;
  merchant_address: string;
  payment_url: string;
  status: Invoice['status'];
  created_at: string;
  updated_at: string;
};

export class SupabaseInvoiceRepository implements InvoiceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(invoice: Invoice): Promise<Invoice> {
    const { data, error } = await this.client
      .from('invoices')
      .insert({
        id: invoice.id,
        title: invoice.title,
        amount_usdt0: invoice.amountUsdt0,
        merchant_address: invoice.merchantAddress,
        payment_url: invoice.paymentUrl,
        status: invoice.status,
        created_at: invoice.createdAt,
        updated_at: invoice.updatedAt,
      })
      .select('*')
      .single();

    if (error || !data) throw new InvoicePersistenceError();
    return mapInvoiceRow(data as InvoiceRow);
  }

  async findById(id: string): Promise<Invoice | null> {
    const { data, error } = await this.client.from('invoices').select('*').eq('id', id).maybeSingle();
    if (error) throw new InvoicePersistenceError();
    return data ? mapInvoiceRow(data as InvoiceRow) : null;
  }

  async listByMerchant(merchantAddress: string): Promise<Invoice[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('merchant_address', merchantAddress)
      .order('created_at', { ascending: false });

    if (error) throw new InvoicePersistenceError();
    return ((data ?? []) as InvoiceRow[]).map(mapInvoiceRow);
  }
}

function mapInvoiceRow(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    title: row.title,
    amountUsdt0: String(row.amount_usdt0),
    merchantAddress: row.merchant_address,
    paymentUrl: row.payment_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class UnconfiguredInvoiceRepository implements InvoiceRepository {
  async create(): Promise<Invoice> {
    throw new DatabaseNotConfiguredError();
  }

  async findById(): Promise<Invoice | null> {
    throw new DatabaseNotConfiguredError();
  }

  async listByMerchant(): Promise<Invoice[]> {
    throw new DatabaseNotConfiguredError();
  }
}

export function createInvoiceRepository(): InvoiceRepository {
  if (!isDatabaseConfigured) return new UnconfiguredInvoiceRepository();

  const client = createClient(databaseConfig.supabaseUrl, databaseConfig.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return new SupabaseInvoiceRepository(client);
}
