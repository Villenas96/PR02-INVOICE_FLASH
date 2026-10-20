import { ProRoute } from "@/components/plan/pro-route";

export default function Page() {
  return (
    <ProRoute feature="bank_reconciliation">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Conciliación bancaria
        </h1>
      </div>
    </ProRoute>
  );
}
