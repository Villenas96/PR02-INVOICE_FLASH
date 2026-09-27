import { ClientDetail } from "@/components/clients/client-detail";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientDetail clientId={id} />;
}
