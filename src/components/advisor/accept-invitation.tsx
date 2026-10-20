"use client";

import { useRouter } from "next/navigation";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { apiRequest, jsonRequest } from "@/lib/api/client";

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const action = useMutation<{ company_id: string }>({ refresh: false });

  async function accept() {
    const accepted = await action.run(() =>
      apiRequest<{ company_id: string }>(
        "/api/v1/advisor-invitations/accept",
        jsonRequest("POST", { token }),
      ),
    );
    if (accepted) {
      router.replace("/documents");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" disabled={action.isLoading} onClick={accept}>
        {action.isLoading ? "Aceptando…" : "Aceptar invitación"}
      </Button>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}
