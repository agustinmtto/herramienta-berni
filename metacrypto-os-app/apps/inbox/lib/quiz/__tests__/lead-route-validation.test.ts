import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  rest: vi.fn(async (_method: string, _path: string, body: { p_payload: Record<string, unknown> }) => ({
    status: 200,
    json: {
      ok: true,
      session_id: body.p_payload.session_id,
      submission_id: "00000000-0000-4000-8000-000000000099",
      status: body.p_payload.event === "completed" ? "completed" : "in_progress",
    },
  })),
}));

process.env.LEAD_RATE_LIMIT_MAX = "2";
process.env.LEAD_COMPLETED_RATE_LIMIT_MAX = "1";
process.env.LEAD_RAW_RATE_LIMIT_MAX = "10";

const { POST } = await import("@/app/api/lead/route");
const { resetRateLimiter } = await import("@/lib/quiz/rate-limit");

const sessionId = "00000000-0000-4000-8000-000000000098";

function call(body: unknown, ip = "127.0.0.9"): Promise<Response> {
  return POST(new Request("http://localhost:3000/api/lead", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "x-real-ip": ip },
    body: JSON.stringify(body),
  }));
}

const tracking = {
  schema_version: 1,
  quiz_version: "diagnostico-cripto-v1-a",
  session_id: sessionId,
  event: "progress",
  occurred_at: "2026-09-21T15:40:00.000Z",
  progress: { step_id: "situation", step_index: 1 },
  answers: [],
};

const completed = {
  ...tracking,
  event: "completed",
  progress: { step_id: "result", step_index: 11 },
  lead: {
    name: "Juan",
    email: "juan@example.com",
    phone: "+54 3585 401429",
    country: "AR",
    consent: { accepted: true, version: "contacto-v1", accepted_at: "2026-09-21T15:39:40.000Z" },
  },
};

describe("POST /api/lead - validación sin base", () => {
  beforeEach(() => resetRateLimiter());

  test("mide bytes UTF-8 aunque no haya Content-Length", async () => {
    const body = JSON.stringify({ data: "á".repeat(40 * 1024) });
    const response = await POST(new Request("http://localhost:3000/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000" },
      body,
    }));
    expect(response.status).toBe(413);
  });

  test("datos de cliente imposibles reciben 4xx controlado", async () => {
    expect((await call({ ...completed, occurred_at: "2026-02-31T15:40:00.000Z" }, "127.0.0.10")).status).toBe(400);
    expect((await call({ ...completed, lead: { ...completed.lead, country: "ZZ" } }, "127.0.0.11")).status).toBe(400);
  });

  test("agotar tracking no bloquea completed y completed conserva antiabuso", async () => {
    expect((await call(tracking)).status).toBe(200);
    expect((await call(tracking)).status).toBe(200);
    expect((await call(tracking)).status).toBe(429);
    expect((await call(completed)).status).toBe(200);
    expect((await call(completed)).status).toBe(429);
  });

  test("tráfico inválido repetido consume la cuota bruta temprana", async () => {
    let response: Response | null = null;
    for (let i = 0; i < 11; i += 1) response = await call({}, "127.0.0.12");
    expect(response?.status).toBe(429);
  });
});
