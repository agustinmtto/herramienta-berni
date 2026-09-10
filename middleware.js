// Request logging middleware — every app/API request hits the terminal
// with method, path, UA and session marker (docs/03 §6).
// Static assets and favicon are silenced via matcher to keep the log readable.

import { NextResponse } from "next/server";

const ts = () => new Date().toISOString().slice(11, 19);
const dim = "\x1b[2m";
const cyan = "\x1b[36m";
const reset = "\x1b[0m";

export function middleware(request) {
  const { method } = request;
  const url = new URL(request.url);
  const pathAndQuery = url.pathname + (url.search || "");
  const ua = (request.headers.get("user-agent") || "unknown-ua").split(")")[0] + ")";

  console.log(`${dim}[${ts()}]${reset} ← ${method} ${cyan}${pathAndQuery}${reset} ${dim}${ua}${reset}`);

  return NextResponse.next();
}

export function config() {
  return {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|frames/).*)"],
  };
}
