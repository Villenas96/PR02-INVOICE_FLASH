import { headers } from "next/headers";
import Link from "next/link";

import { AcceptInvitation } from "@/components/advisor/accept-invitation";
import { auth } from "@/lib/auth";

/** Landing of the advisor invitation email (FR-050). */
export default async function AcceptAdvisorInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  const validToken = typeof token === "string" && token.length > 0;
  const next = validToken
    ? `/advisor/accept?token=${encodeURIComponent(token)}`
    : "/advisor/accept";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <section className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold tracking-tight">Invoice Flash</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Invitación para tu gestoría
        </h1>
        {!validToken ? (
          <p role="alert" className="text-sm text-destructive">
            El enlace de invitación no es válido. Pide a tu cliente que te envíe
            uno nuevo.
          </p>
        ) : session ? (
          <>
            <p className="text-sm text-muted-foreground">
              Vas a acceder como gestoría con la cuenta {session.user.email}.
              Podrás consultar y exportar, pero no modificar nada.
            </p>
            <AcceptInvitation token={token} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Entra o crea tu cuenta con el email en el que recibiste la
              invitación y vuelve a abrir este enlace.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                href={`/login?next=${encodeURIComponent(next)}`}
              >
                Entrar
              </Link>
              <Link
                className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium"
                href="/register"
              >
                Crear cuenta
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
