# Exercise Book: daily learning product proposal

Status: audience and product requirements confirmed; release scope and architecture proposed.
Date: 2026-09-22.

## Intent and evidence

The owner considers the current anonymous preview substantially short of a
production learning product and named Evolton and Kumon as references.
The owner confirmed an initial middle/high-school audience, followed by
expansion to elementary-school learners. The desired learning model is daily,
incremental progression. Matching workbook selection to user conditions,
high-quality printable PDFs, and a usable collection of learning material and
answers are mandatory. Paid subscriptions, exam-prep specialization, exact
curriculum coverage, and implementation details are not approved by this proposal.

Public reference inspection:

- [Evolton](https://evolton.jp/): distinct routes for finding existing material,
  assembling a workbook, and producing answer PDFs. Its homepage makes both
  the task and the resulting artifact visible.
- [Evolton's content process](https://evolton.jp/about/): the operator describes
  independently checked answers, item classification, and permission review.
  These are operator claims, not an independent content-quality audit.
- [Kumon individualization](https://www.kumon.ne.jp/about-kumon/method/individualized-instruction/index.html):
  progression based on the learner's current ability.
- [Kumon self-learning](https://www.kumon.ne.jp/about-kumon/method/self-learning/):
  small steps, examples, and practice intended to support independent work.

Reference use concerns user outcomes and interaction patterns. Exercise Book
needs original curriculum, interface, wording, and appropriately licensed
assets; the references do not authorize importing their problems or solutions.

## Proposed product promise

Open the app, receive a manageable next step, work through it on screen or
paper, understand mistakes, and return to a useful continuation the next day.

Keep two entry paths over the same reviewed content:

1. Daily learning: starting-point check -> today's set -> feedback -> bounded
   correction -> next-session review.
2. Workbook creation: choose topic, level, and time -> inspect the selection ->
   create a fixed workbook -> solve online or print problems and explanations.

`learning.new` continues to enter creation directly. Returning learners may
have a separate application home; an action-domain redirect must not acquire
an extra marketing-page step.

## First coherent release candidate

Use Japanese mathematics as the working subject proposal. Start with one
connected middle-school progression, such as signed numbers, expressions, and
linear equations, that supports at least two weeks of practice. Middle-school
learners can progress through it and high-school learners can use it for
foundation review; this does not constitute high-school curriculum coverage.
Elementary prerequisites can be included as targeted support without claiming
an elementary-school product launch. The precise progression remains proposed.

Each skill needs a reviewed explanation, worked example, independently checked
answers, multiple problem families, common-error feedback, and a review item.
Random numeric variants alone do not constitute curriculum breadth.

The release should include:

- an optional short starting-point check, with a manual topic choice;
- a Japanese daily-work view showing the topic, bounded workload, and why it
  was selected;
- a workbook creator with explicit topic, reviewed difficulty, workload, and
  exercise-purpose conditions, with a preview before creation;
- accessible answer entry, deterministic grading for supported answer types,
  and reviewed stepwise feedback;
- correction within a fixed session budget, with unresolved difficulty carried
  forward rather than an endless drill;
- saving and resuming the exact assignment through a deliberately designed
  identity/privacy boundary;
- downloadable, high-quality problem and explanation PDFs for that same
  assignment, with usable writing space and reviewed Japanese/math pagination;
- a modest progress view distinguishing completed work from independently
  demonstrated retention.

## Screen direction

Replace the current oversized introduction with a working surface that makes
the next action immediately visible. Use original, restrained Japanese
typography, legible mathematical notation, ample writing space, and clear
progress through a finite set.

The daily view prioritizes today's topic, estimated effort, resume/start, and
print. A learner-facing progress view should say what the learner can do and
what needs another try. Keep the initial visual language suitable for teenagers
rather than childlike. Any parent view should emphasize where support is
needed, not only scores or streaks; its first-release scope remains open.

The workbook creator shows an actual content preview before creation. Completed
work leads to useful feedback and a clear stopping point. The design should
make these states reviewable together, including loading, failure, and resume.

## Delivery order and acceptance

1. Validate one complete journey with the confirmed audience using an original interactive
   prototype. Fixtures must be explicitly identified as prototype data.
2. Complete one usable learning session: select workbook conditions, create,
   solve, grade, review explanations, and download printable problem/answer PDFs.
   Check keyboard/mobile use and Japanese/math page layout. Printable browser
   HTML alone does not satisfy the confirmed PDF requirement.
3. Complete the return journey: preserve assignments and attempts, resume after
   refresh, schedule review, and explain the next selection.
4. Expand a reviewed connected curriculum based on observed learner difficulty.

A credible pilot gate is that a learner can start without developer help,
complete a bounded session, understand an error, and resume on another day.
Collect completion, abandonment, repeat-use, and delayed independent-answer
signals with minimal first-party data. Numerical success thresholds need a
defined audience and pilot baseline; none are asserted here.

## Engineering implications

Reuse deterministic generators, exact rational arithmetic, reviewed content
contracts, and student/answer-key projection boundaries. Integrate useful V2
components individually from the draft stack into the actual release base;
passing tests on the V2 branch does not make it the production source.

Persist and hash-verify assignments before presenting saved work. Replayed
creation must return the same assignment. Grade on the server against that
fixed instance; release explanations through an explicit authorization path.
Record first attempts, retries, and hint use separately. Paper self-report
must remain distinguishable from independently observed responses.

Start adaptive selection with inspectable rules over reviewed prerequisites
and evidence, not a new predictive model. AI may assist authoring, but cannot
be the sole answer authority or fill absent curriculum live.

Persistence, identity, evidence, and answer-release boundaries need their own
reviewed contracts and ADRs before implementation. A print failure must preserve
the Web assignment; retries must not substitute questions. Public browsing and
trial use remain accountless. Saved learner information requires access control
and a deletion path.

The greatest product risk is completing more infrastructure while leaving the
learning journey and curriculum incomplete. The next milestone should be
measured by learner behavior, alongside correctness and operational checks.
