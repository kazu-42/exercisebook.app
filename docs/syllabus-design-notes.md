# A usable syllabus for the Japanese algebra foundation

Status: curriculum and delivery proposal, with the pure planner now implemented
in `apps/studio/domain/syllabus.ts`. Integration, generation, and persistence are
separate work. Inspected 2026-09-22 against the Japanese studio worktree. This
document makes no claim of educator approval.

## Product result

Let a learner choose an outcome, starting-point description, two/four/six weeks,
and ten/fifteen/twenty minutes per study day. Return an ordered course whose
sessions actually open a lesson, exercises, checked explanations, and both PDF
variants. Show why each session exists, what the available time covers, and
what remains outside the plan. A timeline whose lessons or PDFs do not exist is
not an acceptable implementation.

Use five planned study days per week initially, stated beside the duration
control. Leave two days for rest or catching up; do not accumulate missed work
onto the next day's capped set. This frequency and the review intervals below
are inspectable product policies, not empirically established optimal doses.

The useful distinction is between choosing a course dynamically from existing
material and adapting a course to observed learning. The former can ship
without learner accounts or historical evidence. The latter needs an explicit
evidence, persistence, privacy, and resumption contract.

## Starting point inspected before this expansion

`apps/studio/server/model.ts` contains forty-eight hand-enumerated mathematical
models. Each topic/level selects the first four, six, or eight entries. The
eighteen workbooks therefore overlap; they are not eighteen independent forms.
The release builder materializes their exact contents and thirty-six PDFs.
The production Worker selects these artifacts and grades integer answers; it
does not execute a question generator.

| Existing selection | Actual exercise capabilities | Material limit |
| --- | --- | --- |
| signed-numbers/foundation | Two-integer addition or subtraction | Eight fixed models |
| signed-numbers/standard | Two-integer multiplication or exact integer division | Eight fixed models |
| expressions/foundation | Evaluate `ax + b` at a positive integer; positive coefficient | Eight fixed models |
| expressions/standard | Evaluate `ax + b` with negative substitution and possibly negative coefficient | Eight fixed models |
| equations/foundation | Solve `ax + b = c`; positive coefficient and positive integer solution | Eight fixed models |
| equations/standard | Solve `ax + b = c`; negative coefficients or solutions included | Eight fixed models |

The model functions derive prompt, answer, mathematical relations, and
explanation from the same inputs. They already reject zero divisors and
noninteger results. That is a useful basis for additional authored forms.
There is no seeded Japanese generator, mixed-skill workbook, expression-answer
grader, equation with a variable on both sides, word-problem family, fraction
answer, or saved learner state. The separate English `fractions.add@1`
generator does not fill any of those gaps.

There are three authored lessons, one per topic. A syllabus needs at least
six targeted lesson selections: an addition example cannot be the only
introduction to multiplication, and positive substitution cannot stand in for
an explanation of substituting a negative value. Sharing supporting prose is
fine; each unit's worked example must match the skill being taught.

## Bounded curriculum and outcomes

Use these public goals:

- `signed-number-confidence`: calculate with positive and negative integers;
- `expression-values`: evaluate a simple expression, including negative inputs;
- `linear-equations`: solve and check an integer equation of the form `ax+b=c`.

The third goal includes the prerequisites of the first two where needed. It
must not be named "complete middle-school algebra" or "high-school math".
The initial audience can include high-school learners reviewing foundations.

The official reference supports the relevance of signed arithmetic,
substitution, equations, and the use of equality properties, while also making
the missing breadth clear. Grade-one mathematics additionally addresses the
meaning and use of expressions, simplifying expressions, and applying
equations in situations. The current six selections are only a foundation
within that scope. See the Ministry of Education's [2017 Course of Study
Commentary, Mathematics, printed pp. 65–73](https://www.mext.go.jp/component/a_menu/education/micro_detail/__icsFiles/afieldfile/2019/03/18/1387018_004.pdf),
retrieved 2026-09-22. No source problem or explanation is copied here.

| Unit | Learner-facing outcome | Required lesson and example | Practice selection |
| --- | --- | --- | --- |
| A: signed-add-subtract | 符号を確かめて、正負の数をたしたりひいたりする | Explain signs and zero, then `−5−(−3)=−2`; connect subtraction to addition of the opposite | signed-numbers/foundation |
| B: signed-multiply-divide | 符号を決めて、かけ算・わり算をする | `−24÷4=−6`; explain inverse multiplication and forbid division by zero | signed-numbers/standard |
| C: substitute-positive | 文字に数を当てはめ、計算の順序を守る | At `x=3`, `2x+5=2×3+5=11`; explain `2x` and the role of `x` | expressions/foundation |
| D: substitute-negative | 負の数を括弧に入れて代入する | At `x=−4`, `3x+1=3×(−4)+1=−11` | expressions/standard |
| E: equation-positive | 両辺に同じ操作をして、解を求める | `2x+3=11`, then `2x=8`, `x=4`; check by substitution | equations/foundation |
| F: equation-signed | 負の係数や負の解でも、等式を保って解く | `−3x+2=14`, then `−3x=12`, `x=−4`; explain nonzero division and verify | equations/standard |

Prerequisites are explicit relations rather than an undifferentiated list:

- A assumes ordinary integer arithmetic and introduces signed-number meaning.
- B requires signed-number meaning taught in A; A-before-B is the initial
  instructional prerequisite policy and should be reviewed with the content.
- C assumes multiplication/addition and understanding the substitution lesson;
  A/B-before-C is recommended for this course, not a mathematical claim that
  negative arithmetic is necessary for positive substitution.
- D requires C and signed arithmetic from A/B.
- E requires C, and introduces equality-preserving inverse operations.
- F requires E and signed arithmetic from A/B; D-before-F is recommended for
  fluent verification with negative solutions.

Represent `hard_prerequisite` separately from `recommended_before`. Only the
former is subject to cycle rejection and prerequisite closure. A standard
algebra course may later add simplifying expressions before equations with
variables on both sides, but that material must exist before scheduling it.

## One session that can be used immediately

Each session owns the following references and actions:

1. A concrete outcome and one sentence explaining its selection.
2. A short explanation and worked example appropriate to the phase and unit.
3. The exact workbook, integer answer entry, and independently checked key.
4. Problem PDF and explanation PDF for that same workbook hash.
5. A clear stop, followed by the next planned session and any optional repair.

Use the existing conservative two-minute estimate per problem until measured
timing supports a new versioned policy. Include lesson reading, answer review,
and correction in the daily cap instead of budgeting only drill time.

| Selected daily cap | Problem ceiling | Problems | Remaining allowance |
| --- | --- | --- | --- |
| 10 minutes | 4 | Up to 8 estimated minutes | 2 minutes for a brief example/review |
| 15 minutes | 6 | Up to 12 estimated minutes | 3 minutes for explanation/review |
| 20 minutes | 8 | Up to 16 estimated minutes | 4 minutes for explanation/review |

These are maximums, not quotas. A new idea may require more reading time: use
four problems on a fifteen-minute introduction, or split the lesson and
practice over two sessions. Reading and solving times are estimates, so also
allow stopping without penalty. The current schema's minimum four problems
does not permit adding a two-question review to a full set. Initially schedule
review as its own capped session; introduce mixed short blocks only with a new
workbook contract and actual mixed PDFs.

Phase meaning:

- `introduce`: explanation visible before practice; correction is supported.
- `practice`: recall the rule, solve, then use worked feedback.
- `review`: revisit an earlier unit after intervening days, labelled with its
  original session and whether the same questions are reused.
- `checkpoint`: try before opening the explanation; show feedback after
  submission. Reused questions remain practice checks, not mastery probes.

## Deterministic planning policy

Start with `algebra-foundation-plan@1`. The planner takes only validated
conditions, a pinned content registry, and explicit optional placement data.
No clock, locale default, live LLM response, or object enumeration may decide
the learning sequence.

1. Expand the chosen goal into available units and prerequisite closure.
2. Establish a stable topological order, breaking ties by an explicit unit
   order. Recommended-before edges influence ties without becoming fake hard
   requirements.
3. Reserve prerequisite verification or introduction, initial practice, spaced
   review, and an end check within `weeks × 5` session slots.
4. Select exact released lesson/workbook/PDF references for each occupied slot.
   If no valid artifact fits the cap, move work to a later slot or report it
   as remaining; never silently increase the budget or swap in other content.
5. Schedule review and later checks at least three study-day slots after the
   previous session on that skill. Leave a day unassigned when no useful work
   meets the gap; do not pad the calendar with drills. Record these as planned
   slot offsets. They are not elapsed-day evidence.
6. Record units introduced, practised, reviewed, and checked separately, plus
   remaining units, unsatisfied assumptions, and reviews due beyond the plan.

A two-week course has ten slots; four weeks has twenty; six weeks has thirty.
More time per day permits more work within an existing unit, not automatic
permission to skip prerequisites. Two weeks need not reach the requested final
goal from every starting point. Return `coverage: "partial"` and offer the
next segment rather than implying completion.

One illustrative four-week route from basics to signed equations is below.
This is a reviewable policy example, not an optimal schedule or a mastery
guarantee. The actual planner must shorten it if lesson/artifact availability
or the cap prevents an entry.

| Week | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 |
| --- | --- | --- | --- | --- | --- |
| 1 | Introduce A | Practice A | Introduce B | Review A | Practice B |
| 2 | Review B | Introduce C | Practice C | Check A | Review B |
| 3 | Introduce D | Practice D | Review C | Introduce E | Practice E |
| 4 | Review D | Introduce F | Practice F | Review E | Check F |

For a two-week beginner route, stop at the available earlier units and show
D–F as remaining when targeting the full route. For six weeks, add meaningful
review/check opportunities for C–F and repair space, not an unsupported new
topic. Shorter goals may finish with fewer than the maximum slots; do not fill
every slot with duplicates to make a calendar look complete.

## Starting point without invented mastery

Offer three descriptions instead of asking a learner to diagnose a numerical
ability level: `from-basics` (はじめから), `some-familiarity` (習ったことはある),
and `review` (復習したい). This is a planning preference with origin
`self-report`; it is neither a correct response nor prerequisite evidence.

For `from-basics`, include all needed introductions. For `some-familiarity`,
keep prerequisites and use short initial checks to decide whether to repeat a
full explanation. For `review`, lead with prerequisite checks and goal-focused
practice, with foundation material one action away. If no observed check data
exists, mark the route provisional and retain every assumed prerequisite in
the plan. Never set `mastered: true` from the selected description.

In the initial unsaved app, this can change explanation emphasis and the
planned first actions; it cannot truthfully claim ongoing adaptation across
days. An incorrect response, blank answer, and invalid input must remain
distinct. Any optional repair replaces remaining work inside the cap; it does
not add an endless drill. A learner who stops can continue from a printed
schedule manually until real saved/resumed state is implemented.

Later evidence-based replanning requires first-attempt, hint, retry, answer
release, elapsed session, family, and paper-self-report distinctions. A
checkpoint can demonstrate performance on that check without proving durable
mastery. Multiple mathematical families, separate sessions, and delayed
unassisted evidence are required by the repository's mastery guardrail.

## Implemented planner interface

The exact shared DTO is `apps/studio/src/syllabus-contracts.ts`. The pure
planner exports `parseSyllabusRequest(value)` and asynchronous
`planSyllabus(value)` from `apps/studio/domain/syllabus.ts`. It strictly accepts
only `goalId`, `startingPoint`, `weeks`, and `dailyMinutes` with the enums above.

`studio-syllabus-v1` includes conditions, policy version, `saved: false`, goal,
explicit self-report status, six-or-fewer prerequisite-linked skills, ordered
sessions, and remaining coverage. Each session includes its objective, lesson
focus, instructions, reflection, check criteria, reason code, and a budget
split between lesson, practice, and reflection. Session index is a one-based
study-day slot and can contain gaps; week/day fields follow that index.

Beginners receive introduce/practice/review/check phases. Learners with some
familiarity receive introduce-with-practice/review/check. Reviewers receive
practice/review/check, retaining the prerequisite content. The planner does
not consume answers or change a learner's mastery state. A skill remains in
`coverage.remainingSkillIds` until all required phases fit, even if its
introduction fits. `coverage.plannedSkillIds` means it occurs in the plan,
not that it is complete or learned.

SHA-256 over RFC 8785 canonical JSON binds the complete payload except `id`
and `planHash`. The public identity is `syllabus-<planHash>` and the policy is
`algebra-foundation-plan@1`. Plan identity covers educational scheduling; it
is not an assignment identity or learner identity.

The implementation decision is to generate each actual workbook only when
the learner explicitly starts a session. Consequently the plan includes no
workbook ID or PDF references before creation. That application operation
must resolve the session against the trusted plan, pin the content/generator
release, materialize and persist its exact assignment, and return Web/PDF
identity. The renderer consumes that persisted assignment and cannot select
new exercises. A client-supplied syllabus is never authority for content or
answers. Planning alone performs no durable write or question generation.

The course page should expose "この回をはじめる" for each planned session, then
"問題PDF" and "解答PDF" for its actual workbook. A printable course schedule is useful, but does not
replace exercise and explanation PDFs. An aggregate course packet can later
concatenate authorized existing artifacts in session order and record that
manifest; the packet builder must never regenerate questions.

## Content expansion needed for a credible long course

The current bank can support an honest course preview with repeated practice,
but cannot supply fresh assignments for two to six weeks. Label repetitions
and show the number of unique questions. Do not market the existing prefix
variants as a fresh question bank or independent checkpoint forms.

The smallest next bank extension keeps the existing three model shapes, but
authors separate A/B/C/D forms for introduction, practice, delayed review, and
checks within each of the six units: six units × four forms × eight items =
192 models. This creates more numerical variety without falsely claiming four
different mathematical families. A six-week course may still intentionally
reuse a form; holdout checking must exclude already exposed question
signatures, including worked examples and downloaded answer forms.

Build-time generation can construct safe integer operands directly. For an
equation choose bounded nonzero coefficient `a`, integer solution `x`, and
constant `b`, then derive `c = a*x+b`; validate independently by substitution.
For exact division choose nonzero divisor and quotient and derive the
dividend. Preserve the model-to-explanation relations, bounded safe arithmetic,
source/license inventory, frozen vectors, semantic duplicate checks, and
versioned selection/generator identity. A seeded generator also records RNG
identity, base seed, and stable slot sub-seeds. Building a larger immutable
catalog before runtime retains the present simple Worker and PDF behavior.

The next genuine mathematical families should add interpretation and transfer,
not only larger integers: a signed change in a familiar quantity, substitution
in a stated rule with units, and a simple situation whose equation is shown
and interpreted. Those require reviewed problem/solution representations and
cannot be claimed by changing a title above the current arithmetic drills.

## Testable acceptance and operations

- All 3 goals × 3 starting points × 3 durations × 3 daily caps (81 inputs)
  produce a deterministic valid plan or an explicit unavailable/partial
  result. Unknown goals, extra fields, or unsupported numbers fail validation.
- Hard prerequisite edges are acyclic. No introduced dependent unit precedes
  its prerequisite introduction/verification. Self-report never changes an
  evidence field or silently satisfies a prerequisite.
- Every emitted session resolves to an active lesson, exact workbook, checked
  key, and both PDFs. A retired content/generator revision blocks new plans;
  it never rebinds an existing course to another workbook.
- Every session estimate is within the selected cap, including lesson/review
  allowances; count is capped; duration is at most `weeks × 5` sessions.
- Review references point backward with the stated minimum gap; unmet reviews
  beyond the course are reported. Planned gaps are not mislabeled as observed
  elapsed time or proof of retention.
- Existing-prefix overlaps and repeated prompts are detected by semantic
  signatures. Repeated items never acquire a fresh-probe label.
- Same conditions, policy, and registry produce the same course hash. Registry
  or selection changes produce a new identity. Both PDF variants still match
  the exact scheduled workbook instance hash and question order.
- Browser checks create different valid plans, open at least one actual
  session from each phase, grade an integer answer, download both PDFs, and
  inspect mobile/keyboard behavior. A missing PDF leaves the Web session and
  entered answers usable.
- Answer payloads, self-reports, and proposed learner history stay out of URLs,
  logs, public artifact keys, and third-party requests. The initial plan owns
  no learner state and must not show fabricated completion streaks.
- Roll back a planner by activating the previous policy for new courses;
  preserve materialized course and workbook identities. Do not mutate the
  existing fixed-workbook contract to smuggle in new scheduling or persistence
  semantics. A public scheduling API and future saved learner state need
  appropriately scoped ADRs when implemented.

## Implementation slices

1. Add the six specific lessons, registry mappings, deterministic course
   selector, coverage explanation, and an actionable syllabus view over the
   existing published catalog. Make repeated content and unsaved state clear.
2. Expand independent forms and PDF artifacts, then add short mixed review
   blocks only when the workbook/print contracts support their exact content.
3. Add explicit starting-point checks and later saved evidence/replanning with
   separate privacy and identity work. Keep course completion, successful
   checks, and demonstrated retention as different concepts.

Each slice must remain usable: real explanations, exercises, answer feedback,
and printable artifacts are the acceptance criteria throughout. The implemented
planner covers deterministic planning, prerequisites, self-report transparency,
finite budgets, and scheduled gaps. It does not by itself satisfy actual
workbook creation, artifact, saved-learning, or educator-review requirements.
