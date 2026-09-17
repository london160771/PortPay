export const databaseConfig = {
  provider: 'supabase-postgres' as const,
  connectionString: process.env.DATABASE_URL?.trim() || '',
  supabaseUrl: process.env.SUPABASE_URL?.trim() || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || '',
};

export const isDatabaseConfigured = Boolean(
  databaseConfig.connectionString ||
    (databaseConfig.supabaseUrl && databaseConfig.supabaseAnonKey),
);
