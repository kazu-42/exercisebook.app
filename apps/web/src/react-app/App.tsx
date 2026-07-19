import { useEffect, useState } from "react";

import {
  FractionBarExplorer,
  WorksheetView,
  type WebWorksheet,
  type WebWorksheetVariant,
} from "@exercisebook/web-renderer";

import { loadSampleFromApi, type SampleLoader } from "./sample-loader.js";

type AppProps = Readonly<{
  initialLocation?: string;
  loadSample?: SampleLoader;
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

function NewPlanPage() {
  return (
    <PageShell>
      <section className="plan-start">
        <div>
          <p className="eyebrow">Start small</p>
          <h1>What would you like to work toward?</h1>
          <p>
            Persistent plans are coming next. For this walking skeleton, choose the
            reviewed fraction path and begin without creating an account.
          </p>
        </div>
        <form
          action="/lessons/fractions/add-unlike-denominators"
          className="plan-card"
          method="get"
        >
          <label>
            <span>Subject</span>
            <select defaultValue="mathematics" name="subject">
              <option value="mathematics">Mathematics</option>
            </select>
          </label>
          <label>
            <span>First goal</span>
            <select defaultValue="fraction-addition" name="goal">
              <option value="fraction-addition">
                Add fractions with unlike denominators
              </option>
            </select>
          </label>
          <fieldset>
            <legend>Time today</legend>
            <label>
              <input name="minutes" type="radio" value="8" />8 minutes
            </label>
            <label>
              <input defaultChecked name="minutes" type="radio" value="12" />
              12 minutes
            </label>
            <label>
              <input name="minutes" type="radio" value="20" />
              20 minutes
            </label>
          </fieldset>
          <button className="button button--primary" type="submit">
            Begin the lesson
          </button>
        </form>
      </section>
    </PageShell>
  );
}

type WorksheetPageProps = Readonly<{
  loadSample: SampleLoader;
  printMode?: boolean;
  variant: WebWorksheetVariant;
}>;

function WorksheetPage({ loadSample, printMode = false, variant }: WorksheetPageProps) {
  const [worksheet, setWorksheet] = useState<WebWorksheet | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setWorksheet(null);
    setFailed(false);

    void loadSample(variant)
      .then((loaded) => {
        if (!active) {
          return;
        }
        if (loaded.variant !== variant) {
          setFailed(true);
          return;
        }
        setWorksheet(loaded);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [loadSample, variant]);

  if (failed) {
    return (
      <div className="worksheet-state">
        <p role="alert">The sample worksheet could not be loaded.</p>
        <a href="/lessons/fractions/add-unlike-denominators">Return to the lesson</a>
      </div>
    );
  }

  if (worksheet === null) {
    return (
      <div className="worksheet-state" role="status">
        <span className="loading-mark" aria-hidden="true" />
        Preparing the fixed sample set…
      </div>
    );
  }

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

export function App({ initialLocation, loadSample = loadSampleFromApi }: AppProps) {
  const location =
    initialLocation ?? `${globalThis.location.pathname}${globalThis.location.search}`;
  const url = new URL(location, "https://exercisebook.app");
  const { pathname } = url;

  if (pathname === "/") {
    return <LandingPage />;
  }

  if (pathname === "/new") {
    return <NewPlanPage />;
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
