# UX principles for FIRE Planner

Read this before you design, build or change any page, component or flow in FIRE Planner: the web app
(`apps/web/src/app/**`, `apps/web/src/components/**`, `globals.css`) and the iPhone companion
(`ios/FIREPlannerSync/App/**`). It applies to every chat and every worktree. The rollout plan is
`docs/ux-rollout/PLAN.md`.

Your goal is to minimize confusion, reduce effort, prevent mistakes, and help the user finish their task fast.
When laws conflict, prioritize clarity, accessibility, user control and task completion. Do not apply them
mechanically. In a money app the tiebreak leans one way: a number the user can trust beats a faster screen.

## Status of the shared pieces (update this section when they change)

The rollout Phase 1 pieces **have shipped** (branch `claude/ux-design-principles-4482fd`). Use them; do not
write your own:

| Need | Use | Notes |
|---|---|---|
| A form that saves | `ActionForm` (`components/action-form.tsx`) | keeps typed values when a save fails, focuses the first bad field, shows `pendingLabel`, shows the action's `data.message` (or `successMessage`) when done |
| A row action, toggle or delete | `ButtonForm` | 40 px (44 px on touch), spinner and `aria-busy` while pending, `doneMessage` or the action's `data.message` as a toast |
| A confirmation | `ButtonForm confirm={{ title, body }}` or `ConfirmDialog` (`components/confirm-dialog.tsx`) | only for actions that cannot be undone or stop something working; title names the thing, body the consequence; focus starts on Cancel |
| Undo | return `data.undo` (form fields) from the action and pass `undo={reverseAction}` to `ButtonForm` | only where the change is really reversible (spending decisions, category toggles, alert dismiss, "Not recurring"); hard deletes get a confirmation, never a fake Undo |
| A status message | `useToast()` (`components/toast.tsx`) | one polite region in the app layout |
| A provider error on screen | `explainError(e, source)` (`lib/explain-error.ts`) | Supabase, Plaid, iPhone sync and network errors in plain words; never the raw message |
| How a save moved the FI date | `withFiEffect(ctx, base, change)` (`server/plan-effect.ts`) | appends "FI date moved 4 mo earlier: Mar 2041 to Nov 2040." to `data.message` |
| A link that is a call to action | `ButtonLink` (`components/ui.tsx`) | same sizes and variants as `Button` |
| Progress | `ProgressBar`, `StepList` (`components/steps.tsx`) | "2 of 4 done", numbered steps with done marks |
| Dates on screen | `dateText`, `dateTimeText` (`lib/format.ts`) | local time, never UTC or ISO strings |
| A chart | `StackedBars`, `TrendLines`, `ValueBars`, `CategoryTrends`, `Donut` (`components/charts/`), rows shaped in `lib/chart-data.ts` | colors only `--chart-1..4` in order (`--chart-5` is "Other"), validated with the dataviz palette script; every chart has a legend or heading, a hover tooltip and a "Show as a table" view; one measure per axis |
| A summary number (a total, a rate, a target) | `DrillTiles` / `DrillRow` (`components/breakdown.tsx`) with a `Breakdown` (`lib/breakdown.ts`) | tap opens what it is made of in place; each step's lines must evaluate to its total (`evaluateStep`, unit-tested); say what is not counted and why; link to where each input is changed; `#id` in the URL opens it |
| The transactions behind a number | `ChargeList` (`components/charges.tsx`) fed by `chargeFinder` (`server/charges.ts`); on a breakdown line, set `BreakdownLine.charges` | "See the 12 charges" opens them in place, newest first, with account names and a total line that equals the figure (or says how it becomes the figure: ÷ 12, annualized); counted amounts carry the reason when they differ from the charge |
| A headline figure that is not a tile | `DrillButton` (`components/breakdown.tsx`) | "See how it adds up" under the figure, same `BreakdownPanel` |
| A chart over time | the `drill` prop of `StackedBars`, `TrendLines` (one `Breakdown` per row) or `CategoryTrends` (per category and month), shown by `PeriodDrill` (`components/period-drill.tsx`); builders in `server/charts/breakdowns.ts` | Tapping a bar or point, or picking the period from the menu under the chart, opens what that period is made of, and each line opens its charges |
| A comparison table | `DrillTable` (`components/drill-table.tsx`) | Every figure is a button; its breakdown opens under the table and Close returns focus to the cell (Scenarios uses it) |
| Parts of a whole as a chart | `Breakdown.chart` (rendered by `Donut`, `components/charts/donut.tsx`) built with `foldSlices` | at most four named slices plus a gray "Other"; the legend lists every value and share |
| Amounts month by month | `MonthlyBars` (`components/charts/monthly-bars.tsx`) | one series, average as a dashed line |

Navigation (`components/app-nav.tsx`) has seven places: Dashboard, Plan, Debts, Spending (tabs Review, Budgets,
Bills), Scenarios, History, Accounts (tabs Accounts, Connections). Alerts sits in the header. Phones get a menu.
Add a page as a tab of an existing place; a new top-level place needs the owner's yes.

`pnpm guards` now includes a UX ratchet (`scripts/guards/ux.mjs`, baseline `scripts/guards/ux-baseline.json`, at
zero): browser dialogs, raw provider errors, controls under 40 px, colors outside the tokens, `<button>` without
`type`, and `<img>` without `alt` all fail CI. Keep every `data-testid` the e2e specs use; rename one only
together with its spec (`node scripts/verify/ux-pages.mjs 3a-dashboard --regressions` checks them all).

## The owner's drill-down rule (every page)

On 2026-11-26 the owner said: "if you're going to display any data to me, I should be able to drill down into
that data if it's being used to calculate something." So:

- Every figure that is a total, an average, a rate, a forecast or any other result opens what it is made of
  (`DrillTiles`, `DrillRow`, `DrillButton`), and each part that comes from transactions opens those
  transactions (`ChargeList`, or `charges` on the breakdown line). No dead ends: the user can always go from
  the headline to the bank lines.
- The list must add up: the charges' total equals the figure, or the panel shows the arithmetic that turns it
  into the figure (a typical charge × 30.44 ÷ cycle days, a year's total ÷ 12). Test it (see
  `apps/web/test/charges.test.ts` and `e2e/specs/drill-charges.spec.ts`).
- A new page or figure without a drill-down is unfinished work, not a follow-up.

Pages that follow it today: Dashboard, Accounts, Debts, Spending (tiles, every category and account), Budgets
(total, each category's month and typical month), Bills (tiles, every series, coming up) and Safe to spend
(headline, every predicted bill and paycheck).

## Checklist: what each law means here

Check each item against what you are about to ship.

1. **Hick (choices):** one question per page (Dashboard: "when am I free?"; Debts: "what do I pay next?"; Spending: "is this number right?"). Hide low-priority options; split big decisions into steps; recommend one option and say why (for example the avalanche order, or "Use as my retirement baseline").
2. **Fitts (size):** every control is at least 40 px tall (`Button` uses `min-h-10`), 44 px on a coarse pointer. No icon-only target; a checkbox's label is part of its target.
3. **Jakob (familiar):** top nav for sections, account and Sign out at the right, settings-like pages (Connections) reachable from the nav, native inputs (`type="month"`, `inputMode="decimal"`), money laid out the way a bank app does.
4. **Proximity:** label, hint and error sit together in `Field`; a row's Remove sits in that row; groups are separated with spacing (`gap-*`), not extra borders.
5. **Miller (chunks):** short `fieldset` groups with a `legend`; long forms become steps or disclosures; never make the user carry a number from another page (show measured spending where the spending field is, as Plan does).
6. **Doherty (400 ms):** every submit goes through `ActionForm` or `ButtonForm` so it shows a pending label at once; results land in an `aria-live` region; sliders and what-ifs run the engine in the browser (`debts/planner.tsx`) instead of waiting on the server.
7. **Von Restorff:** at most one `variant="primary"` per `Card`; row actions are `secondary` or `ghost`; `danger` only for the final destructive step.
8. **Fitts (nearby):** submit sits under the last field (`ActionForm` does this); an action sits beside the thing it changes (rate entry beside its debt, Remove in its row).
9. **Serial position:** the headline answer first (FI date, FI number), the next step or takeaway last, detail in the middle. Order nav and lists by how often they are used.
10. **Peak-end:** a save says what changed in plan terms ("FI date moved from Mar 2041 to Nov 2040"), not only "Saved."; finishing setup or linking a bank lands on the result and says what happens next (first sync, spending review).
11. **Zeigarnik:** the setup card shows done and not-done steps; the spending review shows how many are left; nothing typed is lost on reload or error; returning resumes where the user stopped.
12. **Prägnanz:** `Card`, `Notice`, `Field` and the tokens in `globals.css` only; no decoration that carries no meaning; one message per chart.
13. **Defaults:** preselect the safest common option (measured spending when connected, documented assumption defaults); prefill from what the app already knows; never default into a commitment (a deletion, a disconnect, sharing data); every default is editable on Plan.
14. **Prevent errors:** accept `6500`, `6,500`, `$6,500` and `7` or `7%` where a percent is asked; state units in the label ("%/yr", "per month, after tax"); disable an impossible action and say why ("Add a person first"); name the consequence before a destructive action.
15. **Recoverable errors:** a failed submit keeps every typed value; say what went wrong in plain language and how to fix it (map `ITEM_LOGIN_REQUIRED` to "Sign in to your bank again"); offer Undo for reversible changes and Retry for failed syncs.
16. **Similarity:** reuse `components/ui.tsx` and `components/action-form.tsx`; colors only from tokens; the same word for the same action ("Remove" takes a line out of the plan, "Delete" erases stored data, "Disconnect" stops a bank feed); money always `.num` (tabular figures).
17. **Uniform connectedness:** a `Card` holds a control and the result it changes (slider and payoff chart together); unrelated items live in separate cards.
18. **Parkinson (time):** fewest steps; no confirmation for an action Undo can reverse; prefill; keyboard submit (Enter) works in every form.
19. **Tesler (complexity):** essential fields first, advanced ones (cash return, Fat multiplier, hybrid threshold, emergency months, withdrawal tax) behind a disclosure; the app absorbs internals (Plaid item ids, cursors, error codes, UTC timestamps); show local time.
20. **Goal-gradient:** show progress and milestones (the FI ladder bars, "2 of 4 set up", "8 left to review", progress since last month) and make the remaining step specific.

## Before you finish a UI change

1. Name the page's one question and the shortest path to its answer.
2. Make the next action visually obvious and the only dominant one in its card.
3. Give immediate feedback after every interaction, including failures.
4. Prevent the error first; if it still happens, keep the user's input and say how to fix it.
5. Confirm clearly when the goal is done, in terms of the plan.
6. Keep the `data-testid` attributes and copy the e2e specs depend on, and the "Not financial advice" `Disclaimer`.
7. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm guards` (includes the UX ratchet) and
   `node scripts/verify/ux-check.mjs principles`.

---

## Source text (the owner's instructions, verbatim)

# UX Design Instructions

Follow these instructions whenever you design, build, or revise a user interface. Apply them across layouts, navigation, onboarding, forms, settings, dashboards, and interactive flows.

Your goal is to minimize confusion, reduce effort, prevent mistakes, and help users complete their intended task as quickly as possible.

## 1. Reduce Choices per Screen: Hick's Law

The time required to make a decision increases with the number and complexity of available choices.

* Give each screen one clear purpose.
* Remove irrelevant or low-priority options.
* Break complicated decisions into smaller steps.
* Recommend an option when users may struggle to choose.

## 2. Make Targets Large: Fitts's Law

Large, nearby targets are faster and easier to interact with.

* Make buttons and controls easy to click or tap.
* Give interactive elements sufficient spacing.
* Avoid tiny icons as the only interaction target.
* Increase the clickable area around important controls.

## 3. Follow Familiar Patterns: Jakob's Law

Users expect your product to work like products they already understand.

* Use established interface conventions.
* Place navigation, search, settings, and account controls where users expect them.
* Use familiar icons and interaction patterns.
* Do not invent a new pattern unless it provides a meaningful advantage.

## 4. Group Related Information: Law of Proximity

Elements positioned near one another are perceived as related.

* Place related labels, controls, and information together.
* Use spacing to communicate relationships.
* Separate unrelated groups with additional space.
* Do not rely on borders when spacing can establish the hierarchy.

## 5. Break Content Into Chunks: Miller's Law

Working memory can only process a limited amount of information at once.

* Divide long content into small, meaningful groups.
* Break complex forms and tasks into manageable steps.
* Use headings, sections, and concise labels.
* Avoid asking users to remember information between screens.

## 6. Respond Within 400 Milliseconds: Doherty Threshold

Interfaces feel more productive when feedback appears within approximately 400 milliseconds.

* Acknowledge every user action immediately.
* Show loading, processing, or success states when results are not instant.
* Use optimistic updates when they are safe.
* Never leave users wondering whether their action registered.

## 7. Highlight the Primary Action: Von Restorff Effect

An element that visually differs from surrounding elements receives more attention.

* Give the primary action the strongest visual emphasis.
* Use one dominant call to action per section.
* Keep secondary actions visually quieter.
* Avoid making every button compete for attention.

## 8. Place Key Actions Nearby: Fitts's Law

Interaction becomes faster when important targets are close to the user's current focus.

* Place actions beside the content they affect.
* Keep form submission near the final input.
* Position frequent actions within easy reach.
* Avoid forcing unnecessary cursor or eye movement.

## 9. Put Essentials First: Serial Position Effect

People remember the first and last items in a sequence most clearly.

* Put the most important information first.
* Place the final action or takeaway at the end.
* Keep lower-priority information in the middle.
* Order navigation and lists according to user importance.

## 10. End Flows Memorably: Peak-End Rule

Users judge an experience largely by its most intense moment and how it ends.

* Create a clear and satisfying completion state.
* Confirm what the user accomplished.
* Explain what happens next.
* Avoid ending flows on an empty or ambiguous screen.

## 11. Show Visible Progress: Zeigarnik Effect

Incomplete tasks remain mentally active and encourage users to return.

* Clearly show completed and unfinished steps.
* Save progress whenever possible.
* Make it easy to resume interrupted tasks.
* Use checklists or completion states for multi-step work.

## 12. Simplify Complex Interfaces: Law of Prägnanz

People interpret complex or ambiguous designs in the simplest form possible.

* Prefer simple structures and recognizable shapes.
* Remove unnecessary decoration and visual noise.
* Create an obvious visual hierarchy.
* Make the interface understandable at a glance.

## 13. Use Sensible Defaults: Hick's Law

Helpful defaults reduce the number of decisions users must make.

* Preselect the safest and most common option.
* Use existing context to reduce unnecessary input.
* Never use defaults that create unexpected commitments.
* Make every default easy to change.

## 14. Prevent Errors Proactively: Postel's Law

Interfaces should accept reasonable variations in user input while producing clear, predictable results.

* Accept common input formats and variations.
* Explain requirements before submission.
* Disable impossible or unavailable actions.
* Warn users before risky or destructive actions.

## 15. Make Errors Recoverable: Postel's Law

The interface should handle user mistakes gracefully without creating unnecessary failure.

* Preserve the user's work after an error.
* Explain what went wrong in plain language.
* Tell the user exactly how to fix it.
* Provide undo, retry, restore, or cancel options where appropriate.

## 16. Maintain Pattern Consistency: Law of Similarity

Elements that look similar are perceived as having related purposes.

* Give similar components the same appearance and behavior.
* Use consistent colors, labels, icons, spacing, and interaction states.
* Do not use the same visual treatment for different actions.
* Reuse established components before creating new ones.

## 17. Connect Related Elements Visually: Law of Uniform Connectedness

Visually connected elements are perceived as more closely related.

* Use containers, lines, backgrounds, or shared states to show relationships.
* Visually connect controls to the content they affect.
* Keep unrelated elements visually separate.
* Use connection deliberately, not decoratively.

## 18. Reduce Task Completion Time: Parkinson's Law

Tasks tend to expand to consume the time made available for them.

* Minimize the number of steps required.
* Remove unnecessary confirmations and screens.
* Prefill information the user has already provided.
* Offer shortcuts for frequent or repeat actions.

## 19. Reveal Complexity Gradually: Tesler's Law

Every system contains some complexity that cannot be removed, only managed or transferred.

* Show essential controls first.
* Reveal advanced options only when relevant.
* Let the system handle complexity whenever possible.
* Do not force users to understand internal technical details.

## 20. Make Completion Feel Closer: Goal-Gradient Effect

Motivation increases as users perceive themselves getting closer to a goal.

* Show progress throughout multi-step flows.
* Divide long tasks into visible milestones.
* Emphasize progress already made.
* Make the remaining work feel specific and achievable.

## Implementation Requirements

When creating or revising an interface:

1. Identify the user's primary goal.
2. Design the shortest clear path to that goal.
3. Make the next action visually obvious.
4. Remove anything that distracts from task completion.
5. Provide immediate feedback after every interaction.
6. Prevent errors before they occur.
7. Preserve user work when something goes wrong.
8. Confirm clearly when the goal has been completed.

When laws appear to conflict, prioritize clarity, accessibility, user control, and successful task completion. Do not apply these laws mechanically. Use them to make deliberate decisions based on the user's context and goal.
