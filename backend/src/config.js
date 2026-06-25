import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 8080,
  databaseUrl: process.env.DATABASE_URL || '',
  appPassword: process.env.APP_PASSWORD || 'otimamacaw2025@',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};
