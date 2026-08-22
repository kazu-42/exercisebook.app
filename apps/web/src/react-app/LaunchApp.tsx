import { useEffect, useRef, useState } from "react";

import { WorksheetView } from "@exercisebook/web-renderer";

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

type LaunchAppProps = Readonly<{
  loadPlanPreview?: DailyPlanPreviewLoader;
  planPreviewDefaults?: PlanPreviewDefaults;
}>;

type PracticeMinutes = DailyPlanPreviewRequestV1["practiceMinutes"];

type PlanPreviewState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "success";
      response: DailyPlanPreviewResponseV1;
    }>;

function Brand() {
  return (
    <a aria-label="Exercise Book creation" className="brand" href="/new">
      <span className="brand__mark" aria-hidden="true">
        EB
      </span>
      <span>
        <strong>Exercise Book</strong>
        <small>One reviewed practice set at a time</small>
      </span>
    </a>
  );
}

function PageShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="page-frame">
        <header className="site-header">
          <Brand />
          <p className="site-nav">Anonymous · unsaved · English preview</p>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <p>
            <strong>Exercise Book</strong> uses reviewed content and reproducible
            problems.
          </p>
          <p>Lesson content: CC BY 4.0 · No account or tracking</p>
        </footer>
      </div>
    </>
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
        <p>This page prints the same fixed worksheet shown below.</p>
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

function CreatePreviewPage({
  defaults,
  loadPlanPreview,
}: Readonly<{
  defaults: PlanPreviewDefaults;
  loadPlanPreview: DailyPlanPreviewLoader;
}>) {
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
      setPreviewState({
        status: "success",
        response: validateDailyPlanPreviewResponseV1(response),
      });
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
          <p className="eyebrow">One reviewed English lesson</p>
          <h1>Build a practice preview</h1>
          <p id="plan-preview-privacy">
            Choose a short practice limit. This anonymous preview is not saved and does
            not use your learning history, account, or a mastery estimate.
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
            {([8, 12, 20] as const).map((minutes) => (
              <label key={minutes}>
                <input
                  checked={practiceMinutes === minutes}
                  name="minutes"
                  onChange={() => {
                    selectPracticeMinutes(minutes);
                  }}
                  type="radio"
                  value={minutes}
                />
                {minutes} minutes
              </label>
            ))}
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

export function createBrowserPlanPreviewDefaults(
  now: Date = new Date(),
): PlanPreviewDefaults {
  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = resolvedTimeZone.length > 0 ? resolvedTimeZone : "UTC";
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

export function LaunchApp({
  loadPlanPreview = loadDailyPlanPreviewFromApi,
  planPreviewDefaults = createBrowserPlanPreviewDefaults(),
}: LaunchAppProps) {
  return (
    <CreatePreviewPage
      defaults={planPreviewDefaults}
      loadPlanPreview={loadPlanPreview}
    />
  );
}
