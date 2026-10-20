import { runRoute } from "@/lib/api/route";
import { resolveCompanyContext } from "@/services/context";

// BOM + `;` + comma decimals: opens correctly in Excel configured for Spain.
const TEMPLATE = `﻿descripcion;precio;iva;unidad
Hora de consultoría;45,00;21;hora
Mantenimiento mensual;120,00;21;mes
Libro de formación;18,50;4;unidad
`;

export async function GET(request: Request): Promise<Response> {
  return runRoute(request, "imports.template_failed", async () => {
    await resolveCompanyContext(request, { access: "read" });
    return new Response(TEMPLATE, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="plantilla-catalogo.csv"',
        "Cache-Control": "private, max-age=3600",
      },
    });
  });
}
