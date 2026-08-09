# FORMAT — SPEC.md caveman encoding

Rules for `SPEC.md` & spec-adjacent writes. ⊥ code, error strings, commits, PRs.

## SECTIONS

`SPEC.md` holds, in order:

- **§G** goal — 1 line.
- **§C** constraints — bullets.
- **§I** interfaces — external surfaces (api, cmd, env, file, config).
- **§V** invariants — numbered `V1…`, monotonic, never reused.
- **§T** tasks — pipe table `id|status|task|cites`. Status `x` done, `~` wip, `.` todo. ids `T1…`.
- **§B** bugs — pipe table `id|date|cause|fix`. ids `B1…`.

## GRAMMAR

- Drop articles (a, an, the).
- Drop filler (just, really, basically, simply, actually).
- Drop aux verbs where fragment works (is, are, was).
- No hedging (might, perhaps).
- Fragments fine. Short synonyms: fix > implement, big > extensive, run > execute.

## SYMBOLS

```
→ leads to / on <x>     ∴ therefore / fix     ∀ every     ∃ some
! must     ? may/unknown     ⊥ never/forbidden/nil     ≠ not equal
∈ in     ∉ not in     ≤ at most     ≥ at least     & and     | or     § section ref
```

## PRESERVE VERBATIM

Code blocks, paths, URLs, identifiers, numbers, versions, error strings, SQL/regex/JSON/YAML, quoted strings.

## SHAPES

```
V<n>: <subject> <relation> <condition>
api: POST /x → 200 {id}
T3|.|add auth mw|V1,I.api
B1|2026-04-20|token `<` not `≤`|V2
```

## BOUNDARIES

Prose explanation, external RFC/pitch, commit msg, code comment → normal English.
Cut word loses fact → keep it. Caveman = compression, not amputation.
