"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMutation } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api/client";

/** Asks for confirmation before deleting a draft (FR-017). */
export function DeleteDraftDialog({
  documentId,
  open,
  onOpenChange,
  onDeleted,
}: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const action = useMutation<null>();

  async function handleDelete() {
    const deleted = await action.run(async () => {
      await apiRequest<null>(`/api/v1/documents/${documentId}`, {
        method: "DELETE",
      });
      return null;
    });
    // `run` resolves to undefined on failure and to null on success.
    if (deleted === null) {
      onOpenChange(false);
      onDeleted();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar este borrador?</DialogTitle>
          <DialogDescription>
            El borrador no tiene número ni se ha enviado. Esta acción no se
            puede deshacer.
          </DialogDescription>
        </DialogHeader>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={action.isLoading}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={action.isLoading}
            onClick={handleDelete}
          >
            {action.isLoading ? "Eliminando…" : "Eliminar borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDraftButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Eliminar
      </Button>
      <DeleteDraftDialog
        documentId={documentId}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => router.push("/documents")}
      />
    </>
  );
}

/** Duplicates and opens the new draft, carrying archived-data warnings. */
export function useDuplicateDocument() {
  const router = useRouter();
  const action = useMutation<{ id: string; warnings?: string[] }>();

  async function duplicate(documentId: string) {
    const result = await action.run(() =>
      apiRequest<{ id: string; warnings?: string[] }>(
        `/api/v1/documents/${documentId}/duplicate`,
        { method: "POST" },
      ),
    );
    if (result) {
      const warnings = result.warnings ?? [];
      router.push(
        warnings.length > 0
          ? `/documents/${result.id}?warnings=${warnings.join(",")}`
          : `/documents/${result.id}`,
      );
    }
  }

  return { duplicate, isLoading: action.isLoading, error: action.error };
}
