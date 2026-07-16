## What & why

<!-- What does this change, and why? Link the issue: Closes #NN -->

## How it was verified

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] For tool changes: verified against a **live fort** with `npm run call <tool>` — no mocks

## Facts-only check (tool changes)

- [ ] No advice added to tool payloads. Tools report **facts, not what to do**
      (see the [Contributing](../README.md#contributing) guide). A genuine caveat
      belongs in the tool description, not the per-call output.

## Notes

<!-- Anything reviewers should know -->
