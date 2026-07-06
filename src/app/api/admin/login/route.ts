import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signToken, AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const store = await cookies();
  store.set(AUTH_COOKIE, signToken(process.env.AUTH_SECRET!), {
    httpOnly: true,
    // Secure only in production (HTTPS). On http://localhost a Secure cookie
    // is dropped by the browser, so the proxy guard would never see it.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return NextResponse.json({ ok: true });
}
