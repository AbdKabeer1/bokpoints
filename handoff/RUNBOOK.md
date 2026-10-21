# RUNBOOK

## What is in this repo

- `AGENT.md` — the working contract for agents building BOKPOINTS.
- `docs/source/*.extracted.txt` — raw pypdf text (source of truth for the two documents).
- `docs/PRD.md`, `docs/FRD.md` — the clean Markdown versions (converted).
- `docs/DECISIONS.md`, `docs/HANDOFF.md` — project decision log and handoff notes.

## Convert / regenerate the Markdown

No build tooling is required — the Markdown is maintained by hand.

```bash
cd /Users/mrroddy/bokpoints

# strip PDF artifacts from a source file
sed -E '/^===== PAGE [0-9]+ =====$/d; /^BOKPOINTS: (Product Requirements|Functional Requirements) Document \((PRD|FRD)\)$/d; /^Page [0-9]+ of [0-9]+$/d' \
  docs/source/FRD.extracted.txt
```

## Verify the conversion

```bash
cd /Users/mrroddy/bokpoints/docs

# 1. requirement-ID sets must match the sources exactly
diff <(grep -ohE 'FR-[A-Z]+-[0-9]+' source/*.extracted.txt | sort) \
     <(grep -ohE 'FR-[A-Z]+-[0-9]+' PRD.md FRD.md | sort) && echo "IDs OK"

# 2. acceptance criteria AC-1..AC-11
grep -oE 'AC-[0-9]+' FRD.md | sort -u

# 3. no leftover PDF artifacts (expect no output)
grep -nE '===== PAGE|Page [0-9]+ of' PRD.md FRD.md

# 4. worked example must be verbatim
grep -n 'the store rule is 1 point per euro, rounded down. The cashier enters 23.80 euros. The customer receives 23 points.' FRD.md
```

## Test

No automated test suite exists yet for the docs. Use the verification commands above as the
acceptance check before claiming the conversion is done.

## Deploy

Not applicable — documentation only. Commit both files together with the source they were
derived from.
