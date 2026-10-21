# Project Handoff

## Goal

Turn the two pypdf-extracted source texts for BOKPOINTS into clean, faithful Markdown
(`docs/PRD.md` and `docs/FRD.md`) so the requirements can be read, diffed and implemented
from without PDF-extraction artifacts.

## Deliverables

- [x] `docs/PRD.md` — Product Requirements Document, converted from `docs/source/PRD.extracted.txt`
- [x] `docs/FRD.md` — Functional Requirements Document, converted from `docs/source/FRD.extracted.txt`

## Acceptance criteria

- Every `FR-<MODULE>-<n>` ID preserved verbatim; the set of unique IDs in the output equals the set in the sources (114 unique, 117 total occurrences — verified with `diff` of sorted occurrence lists, identical).
- `AC-1` … `AC-11` all present and unchanged.
- No `===== PAGE n =====` markers, no running headers, no `Page n of m` footers.
- All 10 tables reconstructed as GitHub-flavored Markdown tables with consistent column counts.
- Worked example preserved verbatim: "the store rule is 1 point per euro, rounded down. The cashier enters 23.80 euros. The customer receives 23 points."
- No sentences summarized, shortened or rewritten; only extraction artifacts fixed.

## Deadline

- Date/time: 2026-10-21
- Timezone: local
- Hard or soft deadline: hard (parent-session task)

## Constraints

- Budget: none / free tooling.
- Stack: Markdown only; no build step.
- Accounts/services: none.
- Anything explicitly out of scope: no content edits, no renumbering of requirement IDs, no new sections.
