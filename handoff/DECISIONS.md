# DECISIONS

## Conversion choices

1. **Merged split tables rather than repeating headers.** The PDF repeats the header row at each page break (e.g. `Area Metric`, `Phase Scope`, `Entity Purpose Key fields`, `Situation Required behavior`, `Capability Admin …`). Output keeps one header per logical table and all data rows.
2. **Reordered content that the PDF placed out of flow.** In several places the extractor emitted body text (a bullet list, an open-points list, a traceability table) after the table that logically precedes it. Content was moved back under its own heading; no wording changed.
3. **Rendered the ambiguous PRD §3 stakeholder block as a list.** No header row or cell delimiters survived extraction, so a table could not be reconstructed with confidence.
4. **Kept the "Given / when / then" lines as separate lines** (with hard breaks) in FRD §9 rather than flattening them into one paragraph, to preserve the acceptance-criteria shape.
5. **Bolded requirement IDs** (`**FR-PTS-1**`) and used `####` for the unnumbered group labels inside FRD §5.3 (Profile and staff, Points rules, …). IDs are character-identical to the source.
6. **Normalized the single space before a period** in `FR-PTS-3 .` → `FR-PTS-3.` (extraction artifact).

## Open questions / things to check

- The brief mentioned `D-001`…`D-062`; no such IDs exist in either source file. The only `D-<n>` matches are substrings of `FR-AUD-n` and `FR-CRD-n`. Flag to the parent session.
- PRD §3 could also be a two-column table (stakeholder | description) in the original PDF; if the parent has the PDF, that is worth a visual check.
- FRD §11 heading is "Decisions made and open points" but the source lists open points first and the decisions table second; that order was preserved.
