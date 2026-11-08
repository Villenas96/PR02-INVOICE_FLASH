import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiConnections, oauthConsents } from "@/db/schema";

import { createIntegrationDatabase } from "./database";
import {
  APP_BASE_URL,
  authenticatedRequest,
  createTenant,
  routeContext,
} from "./http";
import {
  authorizeAndConsent,
  exchangeCode,
  pkce,
  REDIRECT_URI,
  registerClient,
} from "./mcp-helpers";

process.env.BETTER_AUTH_SECRET =
  "invoice-flash-contract-secret-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL = APP_BASE_URL;
process.env.APP_BASE_URL = APP_BASE_URL;

const database = createIntegrationDatabase();
vi.mock("@/db", () => ({ createDatabase: () => database }));
vi.mock("@/db/index", () => ({ createDatabase: () => database }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => Promise.resolve({ env: {} }),
}));

const { auth, setAuthEmailDeliveryHandler, MCP_RESOURCE } = await import(
  "@/lib/auth"
);
const aiList = await import("@/app/api/v1/ai-connections/route");
const aiOne = await import("@/app/api/v1/ai-connections/[id]/route");
const wellKnownServer = await import(
  "@/app/.well-known/oauth-authorization-server/route"
);
const wellKnownResource = await import(
  "@/app/.well-known/oauth-protected-resource/route"
);

beforeEach(() => {
  setAuthEmailDeliveryHandler(() => Promise.resolve());
});

describe("OAuth discovery", () => {
  it("publishes the authorization server and protected resource metadata", async () => {
    const server = await auth.handler(
      new Request(
        `${APP_BASE_URL}/api/auth/.well-known/oauth-authorization-server`,
      ),
    );
    expect(server.status).toBe(200);
    const metadata = (await server.json()) as Record<string, unknown>;
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    expect(metadata.registration_endpoint).toBeTruthy();

    const resource = await wellKnownResource.GET(
      new Request(`${APP_BASE_URL}/.well-known/oauth-protected-resource`),
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: MCP_RESOURCE });
    void wellKnownServer;
  });
});

describe("OAuth flow", () => {
  it("registers a public client, authorizes with PKCE and issues an audience-bound token", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth);
    const { verifier, challenge } = pkce();
    const code = await authorizeAndConsent({
      auth,
      cookie: tenant.cookie,
      clientId,
      resource: MCP_RESOURCE,
      challenge,
    });
    const token = await exchangeCode({
      auth,
      clientId,
      code,
      verifier,
      resource: MCP_RESOURCE,
    });
    const tokens = (await token.json()) as Record<string, unknown>;
    expect(token.status, JSON.stringify(tokens)).toBe(200);
    expect(tokens.refresh_token).toBeTruthy();
    const [, payload] = (tokens.access_token as string).split(".");
    const claims = JSON.parse(
      Buffer.from(payload as string, "base64url").toString(),
    ) as Record<string, unknown>;
    expect(claims.aud).toContain(MCP_RESOURCE);
    expect(claims.sub).toBe(tenant.userId);
  });

  it("refuses a code exchange without the PKCE verifier", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth);
    const { challenge } = pkce();
    const code = await authorizeAndConsent({
      auth,
      cookie: tenant.cookie,
      clientId,
      resource: MCP_RESOURCE,
      challenge,
    });
    const token = await exchangeCode({
      auth,
      clientId,
      code,
      resource: MCP_RESOURCE,
    });
    expect(token.status).toBe(400);
  });

  it("refuses a redirect URI that was not registered", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth);
    const response = await auth.handler(
      new Request(
        `${APP_BASE_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: "https://evil.example.test/callback",
          scope: "invoicing",
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
          resource: MCP_RESOURCE,
        })}`,
        { headers: { Cookie: tenant.cookie } },
      ),
    );
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("https://evil.example.test")).toBe(false);
    expect(REDIRECT_URI).not.toContain("evil");
  });
});

describe("assistant connections", () => {
  const post = (tenant: { cookie: string }, clientId: string) =>
    aiList.POST(
      authenticatedRequest(tenant, "/api/v1/ai-connections", {
        method: "POST",
        body: JSON.stringify({ oauth_client_id: clientId }),
      }),
    );

  it("creates a connection for Pro owners, once per assistant", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth, "Claude");
    const first = await post(tenant, clientId);
    expect(first.status).toBe(201);
    const second = await post(tenant, clientId);
    expect(second.status).toBe(201);
    expect(((await first.json()) as { id: string }).id).toBe(
      ((await second.json()) as { id: string }).id,
    );
    const list = (await (
      await aiList.GET(authenticatedRequest(tenant, "/api/v1/ai-connections"))
    ).json()) as { items: Array<{ client_name: string; status: string }> };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      client_name: "Claude",
      status: "active",
    });
  });

  it("refuses to connect on plans without the assistant", async () => {
    const tenant = await createTenant(auth, database, "essential");
    const clientId = await registerClient(auth);
    const response = await post(tenant, clientId);
    expect(response.status).toBe(403);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("feature_not_in_plan");
  });

  it("revoking removes the connection, tokens and consent", async () => {
    const tenant = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth);
    const created = (await (await post(tenant, clientId)).json()) as {
      id: string;
    };
    const { verifier, challenge } = pkce();
    const code = await authorizeAndConsent({
      auth,
      cookie: tenant.cookie,
      clientId,
      resource: MCP_RESOURCE,
      challenge,
    });
    expect(
      (
        await exchangeCode({
          auth,
          clientId,
          code,
          verifier,
          resource: MCP_RESOURCE,
        })
      ).status,
    ).toBe(200);

    const revoked = await aiOne.DELETE(
      authenticatedRequest(tenant, `/api/v1/ai-connections/${created.id}`, {
        method: "DELETE",
      }),
      routeContext({ id: created.id }),
    );
    expect(revoked.status).toBe(204);
    const [row] = await database
      .select({
        status: aiConnections.status,
        revokedAt: aiConnections.revokedAt,
      })
      .from(aiConnections)
      .where(eq(aiConnections.id, created.id));
    expect(row?.status).toBe("revoked");
    expect(row?.revokedAt).toBeTruthy();
    expect(
      await database
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(eq(oauthConsents.clientId, clientId)),
    ).toEqual([]);
  });

  it("answers 404 when revoking another company's connection", async () => {
    const owner = await createTenant(auth, database, "pro");
    const stranger = await createTenant(auth, database, "pro");
    const clientId = await registerClient(auth);
    const created = (await (await post(owner, clientId)).json()) as {
      id: string;
    };
    const response = await aiOne.DELETE(
      authenticatedRequest(stranger, `/api/v1/ai-connections/${created.id}`, {
        method: "DELETE",
      }),
      routeContext({ id: created.id }),
    );
    expect(response.status).toBe(404);
  });
});
