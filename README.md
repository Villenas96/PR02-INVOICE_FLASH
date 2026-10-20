# Invoice Flash

Facturación web para autónomos y pequeños negocios (mercado español).

Stack, decisiones técnicas y contexto completo en [`CLAUDE.md`](./CLAUDE.md), [`specs/001-invoice-flash/`](./specs/001-invoice-flash/) y las mejoras v2 (Factum) en [`specs/002-factum-improvements/`](./specs/002-factum-improvements/).

## Desarrollo

```bash
pnpm install
pnpm dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Comandos

- `pnpm lint` — Biome (lint + formato)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` / `pnpm test:integration` — Vitest
- `pnpm test:e2e` — Playwright
- `pnpm build` — build de Next.js
- `pnpm deploy:staging` / `pnpm deploy:production` — despliegue en Cloudflare Workers (OpenNext); ver `docs/operations/deployment-checklist.md`

## Operación (v2)

- Despliegue: [`docs/operations/deployment-checklist.md`](./docs/operations/deployment-checklist.md).
- Stripe, Resend, colas/DLQ, cron y servidor MCP: [`docs/operations/v2-runbook.md`](./docs/operations/v2-runbook.md).
- Tareas que dependen del titular (infraestructura real, personas): [`docs/operations/pending-manual-tasks.md`](./docs/operations/pending-manual-tasks.md).
- Datos demo (`pnpm db:seed`): cuentas Básico, Esencial y Pro (12 meses de historial y un extracto bancario).
