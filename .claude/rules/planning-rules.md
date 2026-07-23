# Planning Rules

## Mandatory Plan Saving

Before implementing **any** non-trivial feature, change, or fix, the AI agent MUST:

1. **Check** `.claude/plans/` for an existing plan covering the task.
2. **If no plan exists:** Create a new plan before writing any code.

## Plan Storage Format

All plans must be saved to:

```
.claude/plans/YYYY-MM-DD/<feature-slug>.md
```

- `YYYY-MM-DD` — today's date (see `currentDate` in system context).
- `<feature-slug>` — short kebab-case descriptor of the feature (e.g., `user-auth-flow`, `product-crud-api`).

## Date Directory

The `YYYY-MM-DD` subdirectory MUST be created automatically if it does not already exist. Never save plans into a wrong-date folder or omit the date.

## Plan Content Structure

Each plan file should contain:

```markdown
# Plan: <Feature Name>

**Date:** YYYY-MM-DD
**Status:** Draft / Approved / Implemented

## Objective
What this feature/change accomplishes.

## Files to Create / Modify
- `path/to/file.js` — what will change

## Implementation Steps
1. Step one: description
2. Step two: description
   - Sub-step details
3. Step three: description

## Data Model Changes (if any)
- New fields, indexes, schema changes

## API Changes (if any)
- New/modified endpoints, request/response shapes

## Edge Cases & Considerations
- Error scenarios, validation rules, security concerns

## Test Plan
- What to test and how
```

## Enforcement

- The AI agent MUST auto-save the plan to disk before writing any implementation code.
- If the user provides requirements verbally or in chat, the agent writes the plan, saves it, then proceeds.
- Plans are not suggestions — they are saved documentation of the implementation approach.
