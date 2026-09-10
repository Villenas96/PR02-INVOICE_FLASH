"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type AuthMode = "login" | "register" | "forgot-password" | "reset-password";

const content: Record<
  AuthMode,
  { title: string; description: string; submitLabel: string }
> = {
  login: {
    title: "Accede a Invoice Flash",
    description: "Gestiona tus facturas y cobros en un solo lugar.",
    submitLabel: "Entrar",
  },
  register: {
    title: "Crea tu cuenta",
    description: "Empieza a facturar en menos de diez minutos.",
    submitLabel: "Crear cuenta",
  },
  "forgot-password": {
    title: "Recupera tu contraseña",
    description: "Te enviaremos instrucciones si existe una cuenta asociada.",
    submitLabel: "Enviar instrucciones",
  },
  "reset-password": {
    title: "Elige una nueva contraseña",
    description:
      "Usa una contraseña segura que no reutilices en otros servicios.",
    submitLabel: "Guardar contraseña",
  },
};

function errorFromResponse(response: { error?: { message?: string } | null }) {
  if (response.error) {
    throw new Error(
      response.error.message ?? "No se ha podido completar la acción.",
    );
  }
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { error, isLoading, run, status } = useAsyncAction<null>();
  const copy = content[mode];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(false);

    const result = await run(async () => {
      if (mode === "login") {
        const response = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/dashboard",
        });
        errorFromResponse(response);
        return null;
      }

      if (mode === "register") {
        const response = await authClient.signUp.email({
          name,
          email,
          password,
        });
        errorFromResponse(response);
        return null;
      }

      if (mode === "forgot-password") {
        const response = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        errorFromResponse(response);
        return null;
      }

      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) {
        throw new Error(
          "El enlace de recuperación no es válido o ha caducado.",
        );
      }
      const response = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      errorFromResponse(response);
      return null;
    });

    if (result === undefined) {
      return;
    }

    if (mode === "login") {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setSubmitted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-8 space-y-2">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Invoice Flash
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy.title}
          </h1>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          {mode === "register" ? (
            <div className="space-y-2">
              <Label htmlFor="name">Tu nombre</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          {mode !== "reset-password" ? (
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          ) : null}

          {mode !== "forgot-password" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="password">
                  {mode === "reset-password"
                    ? "Nueva contraseña"
                    : "Contraseña"}
                </Label>
                {mode === "login" ? (
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    ¿La has olvidado?
                  </Link>
                ) : null}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === "reset-password"
                    ? "new-password"
                    : "current-password"
                }
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          ) : null}

          {status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {submitted ? (
            <output className="text-sm text-primary" aria-live="polite">
              {mode === "forgot-password"
                ? "Si existe una cuenta, recibirás instrucciones en breve."
                : "Revisa tu correo para verificar la cuenta antes de iniciar sesión."}
            </output>
          ) : null}

          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? "Procesando…" : copy.submitLabel}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              ¿Aún no tienes cuenta?{" "}
              <Link
                href="/register"
                className="text-primary underline-offset-4 hover:underline"
              >
                Regístrate
              </Link>
            </>
          ) : (
            <>
              ¿Ya tienes una cuenta?{" "}
              <Link
                href="/login"
                className="text-primary underline-offset-4 hover:underline"
              >
                Inicia sesión
              </Link>
            </>
          )}
        </p>
      </section>
    </main>
  );
}
