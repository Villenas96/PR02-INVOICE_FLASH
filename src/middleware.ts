export { middleware } from "@/proxies/middleware";

// Declared here, not re-exported: Next.js parses this statically at build time.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
