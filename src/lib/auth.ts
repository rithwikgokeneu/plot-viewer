import { createHmac, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "plot_admin";

export function signToken(secret: string): string {
  return createHmac("sha256", secret).update("admin").digest("hex");
}

export function verifyToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = signToken(secret);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
