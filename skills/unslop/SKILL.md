---
name: unslop
description: Clean up AI-generated or AI-looking code without changing behavior. Use when asked to unslop code, make generated code idiomatic, remove needless abstraction, boilerplate, speculative flexibility, invented defaults, redundant types, verbose names or over-explanation, or to do a human review and cleanup pass. Examples are TypeScript; apply the equivalent in other languages.
---

# Code Cleanup / Human Review

Remove code that exists because a generator was being defensive, explicit, reusable or
future-proof rather than because the product needs it. This is not a redesign and not a
generic "clean code" pass.

Default target is the code just generated, or the current diff. If neither is clear, ask
before touching anything wider.

Never add code for a hypothetical caller, state, failure mode, configuration, compatibility
need or future requirement unless explicitly asked for. Future requirements can add future
code.

## Behavior is a hard constraint

Do not change public or exported APIs, CLI behavior, return values, request/response and
serialized shapes, persistence, network calls, side effects, thrown errors, logging relied
on operationally, configuration semantics, or user-visible output.

If a cleanup would require a behavior change, leave that part alone and report it as a
follow-up. Never use "cleanup" to justify fixing unrelated bugs.

## Order of work

1. Read the surrounding code, real callers, tests and schemas first.
2. Clean production code in small steps. Prefer deleting over replacing.
3. Run the existing tests unchanged. A failure means the cleanup may have changed behavior:
   fix the code, not the test.
4. Run the formatter, linter, type checker, and `fallow` if it is already installed. Never
   install tools or dependencies as part of cleanup.
5. Report.

## What to remove, highest value first

1. **Dead code and unused abstractions.** Confirm callers directly before deleting an
   export. Where `fallow` is available its output is additional evidence, not proof: static
   analysis can miss dynamic use.

2. **Speculative flexibility.** Remove options, hooks, callbacks, factories, interfaces,
   strategies, generics, enum members, compatibility shims and plugin points with one or no
   current use. Do not preserve something because it may be useful later.

3. **Invented defaults never asked for.** Question `?? []`, `?? {}`, `?? ''`, `|| 0`,
   placeholder objects and unknown enum values mapped to a default. Missing and empty are
   different states. If absence is invalid, fail rather than inventing a value. Never use
   `||` where `false`, `0` or `''` are legitimate values.

4. **Artificial optionality.** Remove `?` properties, `T | null` / `T | undefined`, and
   optional parameters when every real caller supplies the value; remove null checks after
   validation and optional chaining on values already proven to exist. For an exported API,
   narrowing a signature is a behavior/API change: leave it and report it.

5. **Needless indirection.** Remove one-caller wrappers, pass-through methods, adapters
   between identical shapes, services wrapping a single library call, classes with no state,
   and abstractions whose only justification is hypothetical reuse.

6. **Defensive error handling.** Question broad `try/catch`, catch-and-rethrow that adds
   nothing, swallowed errors and duplicate logging. Narrow it, but keep handling that protects
   real workflows and never change observable error behavior.

7. **Redundant types.** Reuse the canonical project type or derive from it with
   `Pick`/`Omit` rather than copying its fields. Remove duplicate type shapes and generics with
   one concrete instantiation.

   Do not create a named type or interface for a one-shot local shape. Inline it unless the
   name carries real domain meaning, defines a public contract, or the type is reused.

   Prefer, in order:

   1. existing canonical type
   2. `Pick`, `Omit`, or another simple derivation
   3. inline one-off shape
   4. new named type only when genuinely justified

   Keep intentionally independent contracts separate: an external DTO may correctly remain
   separate from an internal model even when their fields happen to match today.

8. **Comments that restate the code.** Keep comments explaining domain rules, invariants,
   compatibility constraints, incident-derived defensive behavior, or why odd-looking code
   has to stay.

9. **Cosmetic verbosity, only while already editing that code.** Remove ceremonial
   annotations such as `const n: number = items.length`, `x ? true : false`, redundant
   conditionals and needlessly nested ternaries. Removing an annotation can change inference,
   so run the type checker.

Comments and git history are evidence that unusual code may be deliberate, not absolute
authority: verify before removing it, but do not preserve obvious slop solely because an old
comment or commit mentions it. A failing test is not evidence of the same kind — see below.

## Follow the project

Use existing helpers, naming, file layout, error handling, validation and test patterns.
Project convention beats generic best practice unless the convention is itself the slop
being removed.

Do not add dependencies, frameworks, layers, base classes, factories, interfaces,
configuration systems, extension points or abstractions during cleanup unless the current
code genuinely requires them.

Cleanup should shrink the conceptual surface, not grow it.

## Names: short, not cryptic

Prefer the shortest name that is still immediately clear in its scope. Remove words whose
meaning is already supplied by the class, module, function, type, parameter type, or local
context.

* `currentAuthenticatedUserInformation` → `user`
* `validateUserAuthenticationCredentials` → `validateCredentials`
* `UserAuthenticationCredentialsValidationService` → `CredentialValidator`
* inside `UserService`: `getUserByUserId(id)` → `get(id)`

Drop suffixes that add no distinction (`Data`, `Info`, `Object`, `Value`, `Details`,
`Manager`, `Handler`, `Processor`, `Service`), but keep them where they carry real domain or
architectural meaning.

Do not swing the other way into `usr`, `cfg`, `mgr`, `x` unless that abbreviation is already
established locally or the scope is tiny.

The goal is the fewest unnecessary words, not the fewest characters.

Rename only where the better name is obvious from surrounding code. No repo-wide renaming
sweeps.

## Tests

Treat the existing suite as the behavioral contract.

While cleaning production code, do not touch tests, fixtures, snapshots, mocks or expected
values — not to make them pass, and not because a simplified implementation makes one look
obsolete.

Production code and the tests asserting its behavior must not move together during cleanup.

If a test fails after cleanup:

1. assume the production cleanup may be wrong
2. fix or revert the production change
3. run the unchanged test again

If an existing test appears wrong, obsolete, or inconsistent with the specification, leave
it unchanged and report the conflict. Changing behavior and updating its tests is a separate
task.

Once the cleaned production code passes the unchanged tests, behavior preservation is
established and the tests themselves can be updated and cleaned. Do that as a separate step,
never alongside the production changes.

For a risky cleanup, a characterization test may first be added for behavior that already
exists:

1. add the characterization test
2. confirm it passes before cleanup
3. clean the production code
4. confirm the same test still passes

Never write tests for hypothetical behavior.

## Report

Briefly report:

* main cleanup changes
* abstractions, defaults, optionality, types or verbose names removed
* checks run and results
* whether `fallow` ran or was unavailable
* behavior assumptions and remaining risk
* anything noticed but deliberately left alone
* cleaned code with no existing test coverage

Do not explain every trivial edit.
