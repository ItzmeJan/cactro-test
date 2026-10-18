function requiredInProd(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}

const configuredCorsOrigins = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const githubPagesOrigin = "https://itzmejan.github.io";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? "./data/app.db",
  jwtSecret: requiredInProd("JWT_SECRET", "dev-insecure-jwt-secret-change-me"),
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlMs: 7 * 24 * 60 * 60 * 1000,
  otpTtlMs: 10 * 60 * 1000,
  corsOrigin: (origin: string) => {
    if (origin === githubPagesOrigin) return origin;
    if (configuredCorsOrigins.includes("*")) return "*";
    return configuredCorsOrigins.includes(origin) ? origin : undefined;
  },
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
  },
};
