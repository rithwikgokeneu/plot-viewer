import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  return NextResponse.json({ ok: true });
}
