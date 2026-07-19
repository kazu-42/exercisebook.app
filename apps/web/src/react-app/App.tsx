import { useEffect, useRef, useState } from "react";

import {
  FractionBarExplorer,
  WorksheetView,
  type WebWorksheet,
  type WebWorksheetVariant,
} from "@exercisebook/web-renderer";

import { loadSampleFromApi, type SampleLoader } from "./sample-loader.js";
import {
  validateDailyPlanPreviewResponseV1,
  type DailyPlanPreviewResponseV1,
} from "../shared/daily-plan-preview-contract.js";
import {
  DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
  loadDailyPlanPreviewFromApi,
  type DailyPlanPreviewLoader,
  type DailyPlanPreviewRequestV1,
} from "./daily-plan-preview-loader.js";

export type PlanPreviewDefaults = Readonly<{
  localStudyDate: string;
  timeZone: string;
  locale: "en";
}>;

type AppProps = Readonly<{
  initialLocation?: string;
  loadPlanPreview?: DailyPlanPreviewLoader;
  loadSample?: SampleLoader;
  planPreviewDefaults?: PlanPreviewDefaults;
}>;

function Brand() {
  return (
    <a aria-label="Exercise Book home" className="brand" href="/">
      <span className="brand__mark" aria-hidden="true">
        EB
      </span>
      <span>
        <strong>Exercise Book</strong>
        <small>Open learning, one set at a time</small>
      </span>
    </a>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav aria-label="Primary" className="site-nav">
        <a href="/lessons/fractions/add-unlike-denominators">Lesson</a>
        <a href="/worksheet/sample">Today’s set</a>
        <a className="site-nav__start" href="/new">
          Start a plan
        </a>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        <strong>Exercise Book</strong> is being built as a free public learning
        resource.
      </p>
      <p>Reviewed content · reproducible problems · Web and paper from one set</p>
    </footer>
  );
}

function PageShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="page-frame">
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </div>
    </>
  );
}

function LandingPage() {
  return (
    <PageShell>
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Free practice for curious people</p>
          <h1>A new exercise book, every day.</h1>
          <p className="hero__lede">
            Short explanations, deliberate practice, and printable pages that follow
            what you are ready to learn next.
          </p>
          <div className="hero__actions">
            <a
              className="button button--primary"
              href="/lessons/fractions/add-unlike-denominators"
            >
              Try the fraction lesson
            </a>
            <a className="text-link" href="/new">
              Shape a learning plan
            </a>
          </div>
          <ul aria-label="Access promises" className="access-promises">
            <li>No account needed</li>
            <li>Works on paper</li>
            <li>Reviewed, repeatable problems</li>
          </ul>
        </div>

        <aside aria-label="Today’s sample set" className="daily-sheet" role="note">
          <div className="daily-sheet__binding" aria-hidden="true" />
          <p className="daily-sheet__edition">Set 001 · Mathematics</p>
          <h2>Fractions that fit together</h2>
          <dl>
            <div>
              <dt>Study</dt>
              <dd>1 worked example</dd>
            </div>
            <div>
              <dt>Practice</dt>
              <dd>8 focused problems</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>about 16 minutes</dd>
            </div>
          </dl>
          <div aria-hidden="true" className="mini-fractions">
            <span>1/2</span>
            <span>+</span>
            <span>1/3</span>
            <span>=</span>
            <span>?</span>
          </div>
          <a href="/worksheet/sample">Open today’s sample set</a>
        </aside>
      </section>

      <section aria-labelledby="learning-loop-title" className="learning-loop">
        <div className="learning-loop__intro">
          <p className="eyebrow">The daily rhythm</p>
          <h2 id="learning-loop-title">
            Small enough to begin. Exact enough to trust.
          </h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Study one move</h3>
              <p>
                Start with a clear worked example and an interactive way to see the
                idea.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Practice the next right set</h3>
              <p>
                Reviewed generators make a concrete, repeatable set—not a different
                answer every time a page loads.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Keep Web and paper together</h3>
              <p>
                The accessible page and printable view use the very same problem
                instance.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </PageShell>
  );
}

function LessonPage() {
  return (
    <PageShell>
      <article className="lesson">
        <nav aria-label="Breadcrumb" className="breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true">/</span>
          <span>Fractions</span>
        </nav>

        <header className="lesson__header">
          <div>
            <p className="eyebrow">Mathematics · Fraction addition</p>
            <h1>Add fractions by renaming them</h1>
          </div>
          <p>
            Different denominators mean different-size pieces. Rename the fractions so
            their pieces match, then the numerators can be added.
          </p>
        </header>

        <section aria-labelledby="three-moves-title" className="three-moves">
          <h2 id="three-moves-title">The three moves</h2>
          <ol>
            <li>
              <strong>Find</strong>
              <span>a denominator both fractions can use.</span>
            </li>
            <li>
              <strong>Rename</strong>
              <span>each fraction without changing its value.</span>
            </li>
            <li>
              <strong>Add</strong>
              <span>the numerators and keep the shared denominator.</span>
            </li>
          </ol>
        </section>

        <FractionBarExplorer />

        <aside className="lesson-note" role="note">
          <p className="eyebrow">Keep this sentence</p>
          <p>
            We do not add denominators. They name the size of each piece; only the
            number of equal-size pieces changes.
          </p>
        </aside>

        <div className="lesson__next">
          <div>
            <p className="eyebrow">Ready to work it out?</p>
            <h2>Take the idea into a short set.</h2>
          </div>
          <a className="button button--primary" href="/worksheet/sample">
            Practice with today’s set
          </a>
        </div>
      </article>
    </PageShell>
  );
}

type PracticeMinutes = DailyPlanPreviewRequestV1["practiceMinutes"];

type PlanPreviewState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "success";
      response: DailyPlanPreviewResponseV1;
    }>;

type NewPlanPageProps = Readonly<{
  defaults: PlanPreviewDefaults;
  loadPlanPreview: DailyPlanPreviewLoader;
}>;

function NewPlanPage({ defaults, loadPlanPreview }: NewPlanPageProps) {
  const [practiceMinutes, setPracticeMinutes] = useState<PracticeMinutes>(12);
  const [previewState, setPreviewState] = useState<PlanPreviewState>({
    status: "idle",
  });
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  useEffect(
    () => () => {
      requestSequence.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );

  const cancelPendingPreview = (): void => {
    if (activeRequest.current === null) {
      return;
    }
    requestSequence.current += 1;
    activeRequest.current.abort();
    activeRequest.current = null;
    setPreviewState({ status: "idle" });
  };

  const selectPracticeMinutes = (value: PracticeMinutes): void => {
    cancelPendingPreview();
    setPracticeMinutes(value);
    setPreviewState({ status: "idle" });
  };

  const submitPreview = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (activeRequest.current !== null) {
      return;
    }

    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current = controller;
    setPreviewState({ status: "loading" });

    const request: DailyPlanPreviewRequestV1 = {
      schema: DAILY_PLAN_PREVIEW_REQUEST_V1_SCHEMA,
      goalId: "math.fractions.add-unlike",
      practiceMinutes,
      localStudyDate: defaults.localStudyDate,
      timeZone: defaults.timeZone,
      locale: defaults.locale,
    };

    try {
      const response = await loadPlanPreview(request, controller.signal);
      if (controller.signal.aborted || requestSequence.current !== sequence) {
        return;
      }
      const validatedResponse = validateDailyPlanPreviewResponseV1(response);
      setPreviewState({ status: "success", response: validatedResponse });
    } catch {
      if (controller.signal.aborted || requestSequence.current !== sequence) {
        return;
      }
      setPreviewState({ status: "error" });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  };

  return (
    <PageShell>
      <section className="plan-start">
        <div className="plan-start__intro">
          <p className="eyebrow">A small, honest first plan</p>
          <h1>Build a practice preview</h1>
          <p id="plan-preview-privacy">
            Choose a reviewed goal and a short practice limit. This preview is not saved
            and does not use your learning history, account, or a mastery estimate.
          </p>
        </div>
        <form
          aria-describedby="plan-preview-privacy"
          className="plan-card"
          onSubmit={(event) => {
            void submitPreview(event);
          }}
        >
          <label>
            <span>Subject</span>
            <select defaultValue="mathematics" disabled name="subject">
              <option value="mathematics">Mathematics</option>
            </select>
          </label>
          <label>
            <span>Reviewed goal</span>
            <select defaultValue="math.fractions.add-unlike" disabled name="goal">
              <option value="math.fractions.add-unlike">
                Add fractions with unlike denominators
              </option>
            </select>
          </label>
          <fieldset>
            <legend>Practice time</legend>
            <label>
              <input
                checked={practiceMinutes === 8}
                name="minutes"
                onChange={() => {
                  selectPracticeMinutes(8);
                }}
                type="radio"
                value="8"
              />
              8 minutes
            </label>
            <label>
              <input
                checked={practiceMinutes === 12}
                name="minutes"
                onChange={() => {
                  selectPracticeMinutes(12);
                }}
                type="radio"
                value="12"
              />
              12 minutes
            </label>
            <label>
              <input
                checked={practiceMinutes === 20}
                name="minutes"
                onChange={() => {
                  selectPracticeMinutes(20);
                }}
                type="radio"
                value="20"
              />
              20 minutes
            </label>
          </fieldset>
          <p className="plan-card__note">
            Practice time is a hard limit. The 20-minute option currently uses 16
            minutes because only eight reviewed problems are available.
          </p>
          <button
            className="button button--primary"
            disabled={previewState.status === "loading"}
            type="submit"
          >
            {previewState.status === "loading"
              ? "Creating preview…"
              : previewState.status === "error"
                ? "Try again"
                : "Create my preview"}
          </button>
        </form>

        {previewState.status === "loading" ? (
          <div className="plan-preview-state" role="status">
            <span className="loading-mark" aria-hidden="true" />
            Preparing your fixed practice set…
          </div>
        ) : null}

        {previewState.status === "error" ? (
          <div className="plan-preview-state plan-preview-state--error" role="alert">
            <strong>Preview unavailable.</strong>
            <span>
              We could not prepare this preview. Check your connection and try again.
            </span>
          </div>
        ) : null}

        {previewState.status === "success" ? (
          <PlanPreviewResult response={previewState.response} />
        ) : null}
      </section>
    </PageShell>
  );
}

function PlanPreviewResult({
  response,
}: Readonly<{ response: DailyPlanPreviewResponseV1 }>) {
  const { plan, worksheet } = response;

  return (
    <section
      aria-labelledby="plan-preview-title"
      className="plan-preview-result"
      data-plan-id={plan.id}
    >
      <div className="plan-preview-result__heading">
        <div>
          <p className="eyebrow">Ready to use, not saved</p>
          <h2 id="plan-preview-title">Your daily preview</h2>
        </div>
        <p className="plan-preview-result__status" role="status">
          Preview ready. {plan.itemCount} problems are prepared.
        </p>
      </div>

      <dl className="plan-preview-summary">
        <div>
          <dt>Requested practice time</dt>
          <dd>{plan.requestedPracticeMinutes} minutes</dd>
        </div>
        <div>
          <dt>Planned practice time</dt>
          <dd>{plan.plannedPracticeMinutes} minutes</dd>
        </div>
        <div>
          <dt>Set size</dt>
          <dd>{plan.itemCount} problems</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>No</dd>
        </div>
      </dl>

      <div className="plan-preview-rationale">
        <p className="eyebrow">Why this set?</p>
        <p>{plan.selectionExplanation}</p>
      </div>

      <div className="plan-preview-actions">
        <a href="/lessons/fractions/add-unlike-denominators">
          Review the fraction lesson
        </a>
        <button
          className="button button--primary"
          onClick={() => {
            window.print();
          }}
          type="button"
        >
          Print this set
        </button>
      </div>

      <div className="plan-preview-worksheet">
        <WorksheetView printMode worksheet={worksheet} />
      </div>
    </section>
  );
}

type WorksheetPageProps = Readonly<{
  loadSample: SampleLoader;
  printMode?: boolean;
  variant: WebWorksheetVariant;
}>;

type WorksheetPageState =
  | Readonly<{ status: "loading"; variant: WebWorksheetVariant }>
  | Readonly<{ status: "failed"; variant: WebWorksheetVariant }>
  | Readonly<{
      status: "ready";
      variant: WebWorksheetVariant;
      worksheet: WebWorksheet;
    }>;

function WorksheetPage({ loadSample, printMode = false, variant }: WorksheetPageProps) {
  const [state, setState] = useState<WorksheetPageState>({
    status: "loading",
    variant,
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading", variant });

    void loadSample(variant, controller.signal)
      .then((loaded) => {
        if (!active) {
          return;
        }
        if (loaded.variant !== variant) {
          setState({ status: "failed", variant });
          return;
        }
        setState({ status: "ready", variant, worksheet: loaded });
      })
      .catch(() => {
        if (active) {
          setState({ status: "failed", variant });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [loadSample, variant]);

  const visibleState: WorksheetPageState =
    state.variant === variant ? state : { status: "loading", variant };

  if (visibleState.status === "failed") {
    return (
      <div className="worksheet-state">
        <p role="alert">The sample worksheet could not be loaded.</p>
        <a href="/lessons/fractions/add-unlike-denominators">Return to the lesson</a>
      </div>
    );
  }

  if (visibleState.status === "loading") {
    return (
      <div className="worksheet-state" role="status">
        <span className="loading-mark" aria-hidden="true" />
        Preparing the fixed sample set…
      </div>
    );
  }

  const worksheet = visibleState.worksheet;

  if (printMode) {
    return (
      <main className="print-page" id="main-content">
        <div className="print-toolbar">
          <a
            href={
              variant === "student" ? "/worksheet/sample" : "/worksheet/sample/answers"
            }
          >
            Back to Web view
          </a>
          <button
            className="button button--primary"
            onClick={() => {
              window.print();
            }}
            type="button"
          >
            Print
          </button>
        </div>
        <WorksheetView printMode worksheet={worksheet} />
      </main>
    );
  }

  return (
    <PageShell>
      <div className="worksheet-page">
        <nav aria-label="Worksheet actions" className="worksheet-actions">
          <a href="/lessons/fractions/add-unlike-denominators">Review lesson</a>
          {variant === "student" ? (
            <a href="/worksheet/sample/answers">Check answer key</a>
          ) : (
            <a href="/worksheet/sample">Return to student set</a>
          )}
          <a href={`/worksheet/sample/print?variant=${variant}`}>Open print view</a>
        </nav>
        <WorksheetView worksheet={worksheet} />
      </div>
    </PageShell>
  );
}

function NotFoundPage() {
  return (
    <PageShell>
      <section className="not-found">
        <p className="eyebrow">Page not found</p>
        <h1>This page is not in the exercise book.</h1>
        <a className="button button--primary" href="/">
          Return home
        </a>
      </section>
    </PageShell>
  );
}

export function createBrowserPlanPreviewDefaults(
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): PlanPreviewDefaults {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return {
    localStudyDate: `${part("year")}-${part("month")}-${part("day")}`,
    timeZone,
    locale: "en",
  };
}

export function App({
  initialLocation,
  loadPlanPreview = loadDailyPlanPreviewFromApi,
  loadSample = loadSampleFromApi,
  planPreviewDefaults = createBrowserPlanPreviewDefaults(),
}: AppProps) {
  const location =
    initialLocation ?? `${globalThis.location.pathname}${globalThis.location.search}`;
  const url = new URL(location, "https://exercisebook.app");
  const { pathname } = url;

  if (pathname === "/") {
    return <LandingPage />;
  }

  if (pathname === "/new") {
    return (
      <NewPlanPage defaults={planPreviewDefaults} loadPlanPreview={loadPlanPreview} />
    );
  }

  if (pathname === "/lessons/fractions/add-unlike-denominators") {
    return <LessonPage />;
  }

  if (pathname === "/worksheet/sample") {
    return <WorksheetPage loadSample={loadSample} variant="student" />;
  }

  if (pathname === "/worksheet/sample/answers") {
    return <WorksheetPage loadSample={loadSample} variant="answer-key" />;
  }

  if (pathname === "/worksheet/sample/print") {
    const variant =
      url.searchParams.get("variant") === "answer-key" ? "answer-key" : "student";
    return <WorksheetPage loadSample={loadSample} printMode variant={variant} />;
  }

  return <NotFoundPage />;
}
