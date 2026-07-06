import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  return NextResponse.redirect(new URL("/admin/login", request.url), 303);
}
