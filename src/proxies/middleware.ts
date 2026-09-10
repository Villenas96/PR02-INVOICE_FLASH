import { type NextRequest, NextResponse } from "next/server";

import { logSafe } from "@/lib/log";
import { captureException } from "@/lib/sentry";

const PRIVATE_API_PREFIX = "/api/v1";
const PRIVATE_PAGE_PREFIXES = [
  "/dashboard",
  "/documents",
  "/clients",
  "/catalog",
  "/settings",
];
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

function getRequestId(request: NextRequest): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function isPrivatePath(pathname: string): boolean {
  return (
    pathname.startsWith(PRIVATE_API_PREFIX) ||
    PRIVATE_PAGE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function isPrivateApi(pathname: string): boolean {
  return pathname.startsWith(PRIVATE_API_PREFIX);
}

function withRequestId(
  response: NextResponse,
  requestId: string,
): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

function hasSessionCookie(request: NextRequest): boolean {
  // This lightweight edge guard avoids bundling the database-backed auth client
  // into middleware. Server components and API resolvers validate the cookie
  // cryptographically before serving private data.
  return Boolean(
    request.cookies.get("better-auth.session_token") ??
      request.cookies.get("__Secure-better-auth.session_token"),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  try {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    const { pathname } = request.nextUrl;

    if (isPrivatePath(pathname) && !hasSessionCookie(request)) {
      if (isPrivateApi(pathname)) {
        return withRequestId(
          NextResponse.json(
            {
              error: {
                code: "authentication_required",
                message: "Necesitas iniciar sesión para continuar.",
                requestId,
              },
            },
            { status: 401 },
          ),
          requestId,
        );
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return withRequestId(NextResponse.redirect(loginUrl), requestId);
    }

    return withRequestId(
      NextResponse.next({ request: { headers: requestHeaders } }),
      requestId,
    );
  } catch (error) {
    logSafe("error", "middleware.unhandled_error", {
      request_id: requestId,
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    void captureException(error, {
      request_id: requestId,
      source: "middleware",
    });
    return withRequestId(
      NextResponse.json(
        {
          error: {
            code: "internal_error",
            message: "Ha ocurrido un error inesperado.",
            requestId,
          },
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
