import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const store = await cookies();
  store.delete("mcc_session");
  return Response.redirect(new URL("/login", request.url));
}
