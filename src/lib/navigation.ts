import {
  type DocumentType,
  effectiveUiMode,
  type Feature,
  hasFeature,
  type StoredPlan,
  type UiMode,
} from "@/lib/plan";

/**
 * App navigation derived from plan, interface preference and document types
 * already used (specs/002 research R3, FR-057–FR-060). Pure: the server
 * still authorizes every route.
 */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  feature?: Feature;
}

export interface Navigation {
  mode: UiMode;
  primary: NavItem[];
  /** Types offered by «Nuevo ▾», in display order. */
  newDocumentTypes: DocumentType[];
  /** Pro features kept reachable in the simple interface («Más»). */
  more: NavItem[];
  upgrade: NavItem | null;
}

const NEW_DOCUMENT_ORDER: DocumentType[] = [
  "invoice",
  "proforma",
  "quote",
  "delivery_note",
];

/** Optional types that join the simple navigation after their first use. */
const OPTIONAL_TYPE_ITEMS: Array<{ type: DocumentType; label: string }> = [
  { type: "proforma", label: "Proformas" },
  { type: "quote", label: "Presupuestos" },
  { type: "delivery_note", label: "Albaranes" },
];

const CLIENTS: NavItem = {
  key: "clients",
  label: "Clientes",
  href: "/clients",
};
const CATALOG: NavItem = {
  key: "catalog",
  label: "Productos",
  href: "/catalog",
};
const SETTINGS: NavItem = {
  key: "settings",
  label: "Ajustes",
  href: "/settings",
};

const PRO_ITEMS: NavItem[] = [
  {
    key: "recurring",
    label: "Recurrentes",
    href: "/recurring",
    feature: "recurring",
  },
  {
    key: "reconciliation",
    label: "Conciliación",
    href: "/reconciliation",
    feature: "bank_reconciliation",
  },
  {
    key: "exports",
    label: "Exportar",
    href: "/exports",
    feature: "advanced_export",
  },
];

export function buildNavigation(input: {
  plan: StoredPlan;
  uiMode: UiMode | null;
  usedDocumentTypes: readonly DocumentType[];
  creatableTypes: readonly DocumentType[];
}): Navigation {
  const mode = effectiveUiMode(input.plan, input.uiMode);
  const newDocumentTypes = NEW_DOCUMENT_ORDER.filter((type) =>
    input.creatableTypes.includes(type),
  );
  const isPro = hasFeature(input.plan, "full_ui");
  const upgrade: NavItem | null = isPro
    ? null
    : { key: "upgrade", label: "Mejorar a Pro", href: "/billing" };

  if (mode === "full") {
    return {
      mode,
      primary: [
        { key: "dashboard", label: "Resumen", href: "/dashboard" },
        { key: "documents", label: "Documentos", href: "/documents" },
        CLIENTS,
        CATALOG,
        ...PRO_ITEMS,
        SETTINGS,
      ],
      newDocumentTypes,
      more: [],
      upgrade,
    };
  }

  const usedOptional = OPTIONAL_TYPE_ITEMS.filter(({ type }) =>
    input.usedDocumentTypes.includes(type),
  ).map(({ type, label }) => ({
    key: type,
    label,
    href: `/documents?type=${type}`,
  }));

  return {
    mode,
    primary: [
      { key: "invoices", label: "Facturas", href: "/dashboard" },
      ...usedOptional,
      CLIENTS,
      CATALOG,
      SETTINGS,
    ],
    newDocumentTypes,
    more: isPro
      ? [
          {
            key: "dashboard_full",
            label: "Panel completo",
            href: "/dashboard?view=full",
            feature: "dashboard_full",
          },
          ...PRO_ITEMS,
        ]
      : [],
    upgrade,
  };
}
