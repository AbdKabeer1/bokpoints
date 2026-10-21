# STATUS

## Done

- Read `docs/source/PRD.extracted.txt` (333 lines) and `docs/source/FRD.extracted.txt` (799 lines).
- Wrote `docs/PRD.md` — 16 numbered sections, 5 tables, section numbering identical to source.
- Wrote `docs/FRD.md` — 13 numbered sections, 5 tables, section numbering identical to source.
- Removed all `===== PAGE n =====` markers, the running header `BOKPOINTS: ... Document (PRD|FRD)` and all `Page n of m` footers.
- Re-joined hard-wrapped paragraph text; fixed split list markers.
- Reconstructed all 10 tables (PRD: roles, success metrics, scope/phases, key decisions, risks. FRD: roles/permissions, data model, edge cases, decisions, PRD traceability).
- Verification: unique `FR-*` ID sets identical to source (114 unique / 117 occurrences, sorted occurrence lists `diff`-identical); `AC-1`–`AC-11` all present; no page/footer artifacts remain; both worked-example sentences present; table column counts verified programmatically (all consistent).
- Word-level diff against the sources shows only expected deltas (duplicate page-break table headers collapsed, and `FR-PTS-3 .` → `FR-PTS-3.`).

## In progress

- None.

## Blocked

- None.

## Next

- Parent session to review `docs/PRD.md` and `docs/FRD.md`, then proceed to the open decisions in FRD section 11 / PRD section 15.
- Note: the `D-001`…`D-062` IDs mentioned in the task brief do **not** exist in either source file — they are not part of these two documents (likely they live in `docs/DECISIONS.md`).

## Deviations from the source (intentional, artifact fixes only)

1. PRD §3 "Business customer (pays) / End user (free)" has no recoverable table header in the source; rendered as a two-item bullet list instead of a malformed table.
2. PRD §10 "Points expiry" cell reads "…after the day they **are** earned" in the PRD source (the FRD uses "were"). Kept as-is per document.
3. Tables and lists split by page breaks were rejoined: PRD §13 risk table, PRD §8 phase table, FRD §2 permissions table, FRD §3 entity table, FRD §7 edge-case table, FRD §11 open-points list, FRD §12 traceability table.
