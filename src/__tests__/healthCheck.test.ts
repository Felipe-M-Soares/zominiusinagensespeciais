/**
 * Tests for health check response logic
 */
import { describe, it, expect } from "vitest";

// Lógica pura de determinação de status HTTP do health check
function getHealthStatus(dbStatus: string): { status: string; httpCode: number } {
  if (dbStatus === "ok") return { status: "ok", httpCode: 200 };
  return { status: "degraded", httpCode: 503 };
}

// Formata resposta do health check
function buildHealthResponse(dbStatus: string, dbLatencyMs: number, totalMs: number) {
  const { status, httpCode } = getHealthStatus(dbStatus);
  return {
    status,
    db: dbStatus,
    db_latency_ms: dbLatencyMs,
    total_latency_ms: totalMs,
    timestamp: new Date().toISOString(),
    httpCode,
  };
}

describe("getHealthStatus", () => {
  it("returns ok with 200 when db is ok", () => {
    const r = getHealthStatus("ok");
    expect(r.status).toBe("ok");
    expect(r.httpCode).toBe(200);
  });

  it("returns degraded with 503 when db is error", () => {
    const r = getHealthStatus("error");
    expect(r.status).toBe("degraded");
    expect(r.httpCode).toBe(503);
  });

  it("returns degraded with 503 for any non-ok db status", () => {
    expect(getHealthStatus("degraded").httpCode).toBe(503);
    expect(getHealthStatus("not_configured").httpCode).toBe(503);
    expect(getHealthStatus("unknown").httpCode).toBe(503);
  });
});

describe("buildHealthResponse", () => {
  it("includes all required fields", () => {
    const r = buildHealthResponse("ok", 5, 10);
    expect(r).toHaveProperty("status");
    expect(r).toHaveProperty("db");
    expect(r).toHaveProperty("db_latency_ms");
    expect(r).toHaveProperty("total_latency_ms");
    expect(r).toHaveProperty("timestamp");
  });

  it("propagates db status", () => {
    const r = buildHealthResponse("ok", 5, 10);
    expect(r.db).toBe("ok");
    expect(r.status).toBe("ok");
  });

  it("timestamp is valid ISO format", () => {
    const r = buildHealthResponse("ok", 5, 10);
    expect(new Date(r.timestamp).toISOString()).toBe(r.timestamp);
  });

  it("latency values are numbers", () => {
    const r = buildHealthResponse("ok", 5, 15);
    expect(typeof r.db_latency_ms).toBe("number");
    expect(typeof r.total_latency_ms).toBe("number");
  });
});
