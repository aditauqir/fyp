# Agent session requirements

At the start of every session, complete these actions before you edit code:

1. Read `BUG-FIXES.md` and `HANDOFF.md`.
2. Run `node scripts/check-issue-ledger.cjs`.
3. Report every GitHub issue to the user.
4. Include the live GitHub state and the branch state for each issue.

If GitHub is unavailable, use the `BUG-FIXES.md` ledger. Label each reported state as **cached, not live**.

Follow the remaining implementation, build, and handoff requirements in `HANDOFF.md`.

## Record completed work

After every completed task, update `RESUME-WORK-LOG.md` before the final response.

- Create the file if the local ignored file does not exist.
- Append a dated entry for every feature, fix, test, workflow, documentation task, or release task.
- Separate major accomplishments from minor accomplishments.
- Describe the technical difficulty, ownership, product effect, and verification.
- Use strong and expansive impact language.
- Do not invent metrics, users, revenue, production adoption, or verification results.
- Keep `RESUME-WORK-LOG.md` in `.gitignore`. Never commit the file.

If the user asks for a resume or resume material, provide the complete `RESUME-WORK-LOG.md` file. Do not convert the file into a formatted resume unless the user asks.
