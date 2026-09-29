# Gobierno del repositorio

La rama `main` se protege mediante un ruleset de GitHub aplicado por un administrador
del repositorio. Esta configuración no se puede imponer desde los ficheros Git: hay
que verificarla en **Settings → Rules → Rulesets** antes de la primera fusión.

## Ruleset obligatorio para `main`

- Exigir pull request antes de fusionar, con al menos una aprobación.
- Invalidar las aprobaciones obsoletas al recibir nuevos commits.
- Exigir que la conversación esté resuelta antes de fusionar.
- Exigir los checks `CI / Lint (Biome)`, `CI / Type check`, `CI / Unit tests`,
  `CI / Integration tests`, `CI / E2E tests` y `CI / Audit (high/critical)`.
  Son trabajos separados para que GitHub pueda imponerlos individualmente.
- Bloquear push directo y force push, incluidos administradores salvo excepción
  temporal documentada.
- Restringir las eliminaciones de rama y permitir solo merge commits aprobados por
  la política del repositorio.

## Excepción temporal vigente: aprobaciones requeridas = 0

- **Desde**: 2026-09-29. **Motivo**: el repositorio tiene un único desarrollador y
  GitHub no permite aprobar una pull request propia, por lo que la regla de una
  aprobación bloquearía cualquier fusión.
- **Qué cambia**: solo el número de aprobaciones requeridas (1 → 0). Siguen
  vigentes la pull request obligatoria, los checks requeridos en verde, la
  resolución de conversaciones y el bloqueo de push directo y force push.
- **Fin**: se restablece a una aprobación en cuanto se incorpore una segunda
  persona con permisos de revisión. Mientras dure, cada informe de validación
  indica que la fusión se hizo sin revisión humana independiente.

## Operación

CI se ejecuta en pull requests y en actualizaciones de `main`. Dependabot abre
actualizaciones semanales de dependencias y de GitHub Actions. Antes de fusionar,
anotar en el informe de validación el enlace de la pull request y los checks
requeridos que hayan pasado. Los checks de rendimiento se configuran en el workflow
de staging previsto en T128, no en los pull requests generales.
