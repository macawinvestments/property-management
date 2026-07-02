import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 8080,
  databaseUrl: process.env.DATABASE_URL || '',
  appPassword: process.env.APP_PASSWORD || 'otimamacaw2025@',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || 'otima-documents',
    // Endpoint is derived from the account id.
    get endpoint() {
      return `https://${this.accountId}.r2.cloudflarestorage.com`;
    },
  },
  censusApiKey: process.env.CENSUS_API_KEY || '',
  regridToken: process.env.REGRID_TOKEN || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};
