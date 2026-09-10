import { NextResponse } from "next/server";

// Stub endpoint — docs/03 §2 (agnostic JSON). Posts to console for now;
// Supabase integration lands when the business repo is ready (roadmap Fase 1).
export async function POST(request) {
  const lead = await request.json();

  console.info("[lead-payload]", JSON.stringify(lead, null, 2));

  return NextResponse.json({ ok: true, session_id: lead.session_id });
}
