import { describe, expect, it } from "vitest";

import { createDatabase } from "@/db";
import { rateLimits } from "@/db/schema";

import { integrationDatabaseUrl } from "./database";

const databaseUrl = integrationDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET =
  "invoice-flash-integration-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
// Better Auth only enables rate limiting in production builds.
Object.assign(process.env, { NODE_ENV: "production" });

const database = createDatabase(databaseUrl);
const { auth } = await import("@/lib/auth");

function signIn(ip: string) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: "nobody@example.com", password: "x" }),
    }),
  );
}

describe("auth rate limit storage", () => {
  it("persists counters in Postgres and limits per client IP", async () => {
    // Better Auth's built-in rule for sign-in: 3 requests per 10 seconds.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await signIn("203.0.113.10")).status);
    }

    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);

    const rows = await database.select().from(rateLimits);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.key.includes("203.0.113.10"))).toBe(true);

    // A different client IP has its own counter.
    expect((await signIn("203.0.113.11")).status).not.toBe(429);
  });
});
