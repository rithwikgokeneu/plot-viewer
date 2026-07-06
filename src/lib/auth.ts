import { createHmac, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "plot_admin";

export function signToken(secret: string): string {
  return createHmac("sha256", secret).update("admin").digest("hex");
}

export function verifyToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = signToken(secret);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
