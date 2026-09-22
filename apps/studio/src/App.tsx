import { useEffect, useRef, useState } from "react";
import type {
  ExplanationStep,
  GradeResult,
  Level,
  PdfVariant,
  ProblemCount,
  Topic,
  TopicId,
  Workbook,
  WorkbookRequest,
} from "./contracts";
import { SyllabusBuilder } from "./SyllabusBuilder";
import type { SyllabusPlan, SyllabusSession } from "./syllabus-contracts";
import { explanationRelationLabels } from "./contracts";
import {
  parseCatalog,
  parseGradeResult,
  parseWorkbook,
  readResponseJson,
} from "./response-validation";

type View = "syllabus" | "create" | "today" | "library" | "study";
const levels: { id: Level; name: string; detail: string }[] = [
  { id: "foundation", name: "基礎を固める", detail: "例題から、一歩ずつ" },
  { id: "standard", name: "標準に挑戦", detail: "符号や手順を確かめる" },
];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    book: "M4 4h6c2 0 2 1 2 1s0-1 2-1h6v15h-6c-2 0-2 1-2 1s0-1-2-1H4V4m8 1v15",
    grid: "M4 4h6v6H4V4m10 0h6v6h-6V4M4 14h6v6H4v-6m10 0h6v6h-6v-6",
    sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    download: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4",
    check: "m5 12 4 4L19 6",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2",
    chevron: "m9 5 7 7-7 7",
    pen: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6",
    info: "M12 10v6m0-9v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}

async function request<T>(
  url: string,
  parse: (value: unknown) => T,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(url, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
    signal,
  });
  return parse(await readResponseJson(response, signal));
}

export function App() {
  const [view, setView] = useState<View>("syllabus");
  const [syllabus, setSyllabus] = useState<SyllabusPlan | undefined>();
  const [session, setSession] = useState<SyllabusSession | null>(null);
  const [topics, setTopics] = useState<readonly Topic[]>([]);
  const [topicId, setTopicId] = useState<TopicId>("equations");
  const [level, setLevel] = useState<Level>("foundation");
  const [count, setCount] = useState<ProblemCount>(6);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(true);
  const [busy, setBusy] = useState<"create" | "grade" | null>(null);
  const [pdfBusy, setPdfBusy] = useState<PdfVariant | null>(null);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState(false);
  const [about, setAbout] = useState(false);
  const [retryCatalog, setRetryCatalog] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(0);
  const pdfOperation = useRef(0);
  const pendingCreation = useRef<{ fingerprint: string; key: string } | null>(null);
  const sessionKeys = useRef(new Map<string, string>());
  const selected = topics.find((topic) => topic.id === topicId) ?? topics[0];

  useEffect(() => {
    let active = true;
    setCatalogError(false);
    request("/studio-api/catalog", parseCatalog)
      .then((data) => {
        if (!Array.isArray(data.topics) || data.topics.length === 0)
          throw new Error("Empty catalog");
        if (active) setTopics(data.topics);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, [retryCatalog]);

  useEffect(() => {
    if (view === "study") heading.current?.focus();
  }, [view, workbook]);
  useEffect(() => {
    if (!about) return;
    dialog.current?.showModal();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbout(false);
      if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (
          first &&
          last &&
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [about]);

  function navigate(next: View) {
    if (busy) return;
    setView(next);
    setError("");
  }

  async function createWorkbook(
    conditions?: WorkbookRequest,
    plannedSession?: SyllabusSession,
  ) {
    if (!selected || busy) return;
    const selection = conditions ?? { topicId: selected.id, level, count };
    const sessionKey =
      plannedSession && syllabus ? `${syllabus.id}/${plannedSession.id}` : undefined;
    const fingerprint = JSON.stringify({ selection, sessionKey: sessionKey ?? null });
    let key = sessionKey ? sessionKeys.current.get(sessionKey) : undefined;
    key ??=
      pendingCreation.current?.fingerprint === fingerprint
        ? pendingCreation.current.key
        : crypto.randomUUID();
    pendingCreation.current = { fingerprint, key };
    if (sessionKey) sessionKeys.current.set(sessionKey, key);
    const token = ++operation.current;
    setBusy("create");
    setError("");
    try {
      const data = await request("/studio-api/workbooks", parseWorkbook, selection, {
        "Idempotency-Key": key,
      });
      if (token !== operation.current) return;
      if (
        data.topicId !== selection.topicId ||
        data.level !== selection.level ||
        data.count !== selection.count
      )
        throw new Error("Mismatched workbook conditions");
      pendingCreation.current = null;
      pdfOperation.current += 1;
      setPdfBusy(null);
      setError("");
      setWorkbook(data);
      setAnswers({});
      setResult(null);
      setRevealed(false);
      setSession(plannedSession ?? null);
      setExampleOpen(plannedSession?.phase !== "checkpoint");
      setView("study");
    } catch {
      setError(
        "問題集を準備できませんでした。少し待ってから、もう一度お試しください。",
      );
    } finally {
      if (token === operation.current) setBusy(null);
    }
  }

  async function grade(revealOnly = false) {
    if (!workbook || busy) return;
    setBusy("grade");
    setError("");
    try {
      const data = await request(
        "/studio-api/workbooks/" + workbook.id + "/grade",
        (value) => parseGradeResult(value, workbook),
        { answers },
      );
      if (
        data.workbookId !== workbook.id ||
        data.items.length !== workbook.items.length
      )
        throw new Error("Mismatched response");
      setResult(data);
      setRevealed(revealOnly);
    } catch {
      setError(
        "答え合わせができませんでした。入力した答えはこの画面に残っています。もう一度お試しください。",
      );
    } finally {
      setBusy(null);
    }
  }

  async function download(variant: PdfVariant) {
    if (!workbook || pdfBusy) return;
    const token = ++pdfOperation.current;
    setPdfBusy(variant);
    setError("");
    try {
      const response = await fetch(
        "/studio-api/workbooks/" + workbook.id + "/pdf?variant=" + variant,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("application/pdf")
      )
        throw new Error("PDF failed");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "exercisebook-" + workbook.topicId + "-" + variant + ".pdf";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      if (token === pdfOperation.current) {
        setError(
          "PDFを作成できませんでした。問題と入力内容はそのまま使えます。もう一度お試しください。",
        );
      }
    } finally {
      if (token === pdfOperation.current) setPdfBusy(null);
    }
  }

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("syllabus");
          }}
          aria-label="Exercise Book 学習計画"
        >
          <span className="brand-mark">
            <Icon name="book" size={26} />
          </span>
          <span>
            Exercise Book<small>学ぶ、を自分のペースで。</small>
          </span>
        </a>
        <p className="nav-caption">YOUR STUDY DESK</p>
        <nav aria-label="メインメニュー">
          {(
            [
              { id: "syllabus", icon: "book", name: "学習計画をつくる" },
              { id: "today", icon: "sun", name: "今日の学習" },
              { id: "create", icon: "pen", name: "問題集をつくる" },
              { id: "library", icon: "grid", name: "教材をみる" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              className={"nav-item " + (view === item.id ? "active" : "")}
              onClick={() => navigate(item.id)}
              disabled={!!busy}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {view === item.id && <span className="nav-dot" />}
            </button>
          ))}
          {workbook && (
            <button
              className={"nav-item resume " + (view === "study" ? "active" : "")}
              aria-label="取り組み中の問題集"
              aria-current={view === "study" ? "page" : undefined}
              onClick={() => navigate("study")}
              disabled={!!busy}
            >
              <Icon name="book" />
              <span>取り組み中の問題集</span>
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <span className="little-line" />
          <p>
            わかることを、
            <br />
            少しずつ。
          </p>
          <span>
            一問の「できた」から、
            <br />
            次の一歩がはじまります。
          </span>
        </div>
        <div className="sidebar-bottom">
          <span className="edition">JAPANESE EDITION · 01</span>
          <button onClick={() => setAbout(true)}>
            <Icon name="info" size={15} />
            この体験版について
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            学習デスク <span>/</span>{" "}
            <strong>
              {view === "syllabus"
                ? "学習計画をつくる"
                : view === "study"
                  ? "問題に取り組む"
                  : view === "today"
                    ? "今日の学習"
                    : view === "library"
                      ? "教材をみる"
                      : "問題集をつくる"}
            </strong>
          </div>
          <button className="prototype-tag" onClick={() => setAbout(true)}>
            <span />
            体験版 <Icon name="info" size={14} />
          </button>
        </header>
        <main id="main">
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="info" />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="エラー表示を閉じる">
                ×
              </button>
            </div>
          )}
          {catalogError ? (
            <section className="empty-state">
              <h1>教材を読み込めませんでした</h1>
              <p>接続を確認して、もう一度お試しください。</p>
              <button
                className="primary-button"
                onClick={() => setRetryCatalog((value) => value + 1)}
              >
                もう一度読み込む
              </button>
            </section>
          ) : !selected ? (
            <div className="empty-state" role="status">
              教材を準備しています…
            </div>
          ) : view === "syllabus" ? (
            <SyllabusBuilder
              busy={!!busy}
              {...(syllabus ? { initialPlan: syllabus } : {})}
              onPlanChange={setSyllabus}
              onStartSession={(planned) =>
                createWorkbook(
                  {
                    topicId: planned.topicId,
                    level: planned.level,
                    count: planned.count,
                  },
                  planned,
                )
              }
            />
          ) : view === "create" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">MAKE YOUR WORKBOOK</p>
                  <h1>
                    <span className="heading-part">いまの自分に、</span>
                    <wbr />
                    <span className="heading-part">ちょうどいい一冊。</span>
                  </h1>
                  <p>学びたいことと分量を選んで、今日の問題集をつくりましょう。</p>
                </div>
                <span className="subject-badge">
                  数学<span>中学の基礎</span>
                </span>
              </div>
              <div className="builder-layout">
                <div className="builder">
                  <section className="form-section">
                    <div className="section-label">
                      <span>01</span>
                      <h2>何を練習しますか？</h2>
                    </div>
                    <fieldset className="topic-options">
                      <legend className="sr-only">学習する単元</legend>
                      {topics.map((topic) => (
                        <label
                          className={
                            "topic-option " +
                            (selected.id === topic.id ? "selected" : "")
                          }
                          key={topic.id}
                        >
                          <input
                            type="radio"
                            name="topic"
                            value={topic.id}
                            checked={selected.id === topic.id}
                            onChange={() => setTopicId(topic.id)}
                          />
                          <span className="topic-symbol" aria-hidden="true">
                            {topic.id === "signed-numbers"
                              ? "±"
                              : topic.id === "expressions"
                                ? "x"
                                : "="}
                          </span>
                          <span className="topic-copy">
                            <strong>{topic.title}</strong>
                            <small>{topic.subtitle}</small>
                          </span>
                          <span className="radio-indicator">
                            {selected.id === topic.id && (
                              <Icon name="check" size={12} />
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </section>
                  <section className="form-section">
                    <div className="section-label">
                      <span>02</span>
                      <h2>取り組み方を選ぶ</h2>
                    </div>
                    <fieldset className="level-options">
                      <legend className="sr-only">難易度</legend>
                      {levels.map((item) => (
                        <label
                          key={item.id}
                          className={
                            "level-option " + (level === item.id ? "selected" : "")
                          }
                        >
                          <input
                            type="radio"
                            name="level"
                            value={item.id}
                            checked={level === item.id}
                            onChange={() => setLevel(item.id)}
                          />
                          <span className="level-top">
                            <strong>{item.name}</strong>
                            <span className="small-radio" />
                          </span>
                          <small>{item.detail}</small>
                        </label>
                      ))}
                    </fieldset>
                  </section>
                  <section className="form-section volume-section">
                    <div className="section-label">
                      <span>03</span>
                      <h2>今日の分量</h2>
                    </div>
                    <fieldset className="count-options">
                      <legend className="sr-only">問題数</legend>
                      {([4, 6, 8] as const).map((value) => (
                        <label
                          key={value}
                          className={count === value ? "selected" : ""}
                        >
                          <input
                            type="radio"
                            name="count"
                            value={value}
                            checked={count === value}
                            onChange={() => setCount(value)}
                          />
                          <strong>
                            {value}
                            <span>問</span>
                          </strong>
                          <small>
                            {value === 4
                              ? "さっと確認"
                              : value === 6
                                ? "ほどよく練習"
                                : "じっくり定着"}
                          </small>
                        </label>
                      ))}
                    </fieldset>
                  </section>
                  <div className="create-footer">
                    <div className="included">
                      <Icon name="check" size={15} />
                      例題・練習問題・解答解説つき
                    </div>
                    <button
                      className="primary-button create-button"
                      onClick={() => void createWorkbook()}
                      disabled={!!busy}
                    >
                      {busy === "create"
                        ? "問題集を準備しています…"
                        : "この内容で問題集をつくる"}
                      <Icon name="arrow" size={20} />
                    </button>
                    <p className="privacy-note">
                      登録なしで、新しい問題を作成できます。入力した答えや成績は保存しません。
                    </p>
                  </div>
                </div>
                <div className="preview-column">
                  <div className="preview-heading">
                    <span>YOUR NEXT WORKBOOK</span>
                    <span className="preview-live">紙面イメージ</span>
                  </div>
                  <PaperPreview topic={selected} count={count} level={level} />
                  <div className="preview-caption">
                    <Icon name="book" size={18} />
                    <p>
                      画面でも、紙でも。
                      <br />
                      <span>作成した同じ問題を、A4のPDFで。</span>
                    </p>
                  </div>
                  <div className="preview-details">
                    <span>問題編 ＋ 解答・解説編</span>
                    <span>書き込みスペースつき</span>
                  </div>
                </div>
              </div>
              <div className="bottom-note">
                <span>一冊を、最後まで。</span>
                <p>
                  例題で確かめる。自分で解く。解説でふり返る。
                  <br className="mobile-break" />
                  その繰り返しを、大切にしています。
                </p>
              </div>
            </>
          ) : view === "library" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">SMALL STEPS, SOLID FOUNDATIONS</p>
                  <h1>わかるところから、ひとつずつ。</h1>
                  <p>中学数学の基礎を、高校生の学び直しにも。</p>
                </div>
              </div>
              <p className="scope-note">
                現在は3テーマの試作教材です。中学・高校の全範囲には対応していません。
              </p>
              <div className="library-grid">
                {topics.map((topic) => (
                  <article className="lesson-card" key={topic.id}>
                    <div className="lesson-card-top">
                      <span>CHAPTER {topic.number}</span>
                      <Icon name="book" />
                    </div>
                    <h2>{topic.title}</h2>
                    <p>{topic.description}</p>
                    <div className="lesson-sample math">{topic.sample}</div>
                    <p className="prerequisite">
                      先に確かめたいこと<span>{topic.prerequisite}</span>
                    </p>
                    <details>
                      <summary>例題と解き方を見る</summary>
                      <p>{topic.lesson.rule}</p>
                      <div className="math">{topic.lesson.example}</div>
                      <ExplanationSteps steps={topic.lesson.steps} />
                    </details>
                    <button
                      className="text-button"
                      onClick={() => {
                        setTopicId(topic.id);
                        navigate("create");
                      }}
                    >
                      この単元で問題集をつくる
                      <Icon name="arrow" size={18} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : view === "today" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ONE SMALL STEP TODAY</p>
                  <h1>今日も、自分のペースで。</h1>
                  <p>ひとつのテーマを、短い時間でじっくりと。</p>
                </div>
              </div>
              {workbook ? (
                <section className="today-card">
                  <div>
                    <span className="pill">この画面で作成した問題集</span>
                    <h2>{workbook.title}</h2>
                    <p>
                      {workbook.count}問 · {workbook.levelLabel} · 目安
                      {workbook.minutes}分
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => navigate("study")}
                    >
                      続きから取り組む
                      <Icon name="arrow" />
                    </button>
                  </div>
                  <div className="today-art" aria-hidden="true">
                    x + <span>一歩</span>
                  </div>
                </section>
              ) : (
                <section className="today-card">
                  <div>
                    <span className="pill">はじめての一冊</span>
                    <h2>
                      まずは、いまの自分を
                      <br />
                      確かめてみよう。
                    </h2>
                    <p>
                      取り組みたい単元と分量を選べます。
                      <br />
                      迷ったら、基礎の4問から。
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setCount(4);
                        setLevel("foundation");
                        navigate("create");
                      }}
                    >
                      今日の問題集をつくる
                      <Icon name="arrow" />
                    </button>
                  </div>
                  <div className="today-art" aria-hidden="true">
                    1<span>STEP AT A TIME</span>
                  </div>
                </section>
              )}
              <div className="today-explainer">
                <h2>毎日の、小さな学び方。</h2>
                <div>
                  {[
                    ["01", "例題を読む", "新しい考え方を、まず一問で。"],
                    ["02", "自分で解く", "紙でも画面でも、手を動かす。"],
                    ["03", "解説で確かめる", "間違えたところが、次の一歩。"],
                  ].map(([n, title, text]) => (
                    <article key={n}>
                      <span>{n}</span>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </article>
                  ))}
                </div>
                <p className="scope-note">
                  学習計画で、次に学ぶことや復習する回を決められます。学習履歴の自動保存・習熟度の自動判定には対応していません。
                </p>
                <button className="text-button" onClick={() => navigate("syllabus")}>
                  学習計画をひらく <Icon name="arrow" />
                </button>
              </div>
            </>
          ) : (
            workbook && (
              <>
                <div className="page-heading study-heading">
                  <div>
                    <p className="eyebrow">YOUR WORKBOOK · {workbook.levelLabel}</p>
                    <h1 ref={heading} tabIndex={-1}>
                      {workbook.title}
                    </h1>
                    <p>{workbook.reason}</p>
                  </div>
                  <div className="workbook-meta">
                    <span>
                      <Icon name="book" size={16} />
                      {workbook.count}問
                    </span>
                    <span>
                      <Icon name="clock" size={16} />
                      目安 {workbook.minutes}分
                    </span>
                  </div>
                </div>
                <div className="study-toolbar">
                  <span>
                    <Icon name="pen" size={17} />
                    画面で解く / 紙に印刷する
                  </span>
                  <div>
                    {(
                      [
                        { id: "student", name: "問題PDF" },
                        { id: "answers", name: "解答PDF" },
                      ] as const
                    ).map((item) => (
                      <button
                        className="secondary-button"
                        key={item.id}
                        onClick={() => void download(item.id)}
                        disabled={!!pdfBusy}
                      >
                        <Icon name="download" size={17} />
                        {pdfBusy === item.id ? "PDFを作成中…" : item.name}
                      </button>
                    ))}
                  </div>
                </div>
                {session && (
                  <section className="session-context" aria-label="この回の学習目標">
                    <div>
                      <p className="eyebrow">
                        第{session.week}週 · {session.day}回目
                      </p>
                      <h2>{session.title}</h2>
                      <p>{session.objective}</p>
                    </div>
                    <p>
                      <strong>取り組み方</strong> {session.instructions.join(" ")}
                    </p>
                    <p>
                      <strong>終わったら確かめること</strong>{" "}
                      {session.checkpointCriteria}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate("syllabus")}
                    >
                      学習計画にもどる <Icon name="arrow" size={16} />
                    </button>
                  </section>
                )}
                {pdfBusy && (
                  <p className="pdf-status" role="status">
                    日本語と数式を整えてPDFを作っています。そのままお待ちください。
                  </p>
                )}
                <section className="worked-example">
                  <div className="example-label">
                    <span>まずは一問</span>
                    <h2>{workbook.lesson.title}</h2>
                  </div>
                  <div>
                    {session?.phase === "checkpoint" && (
                      <p className="checkpoint-note">
                        到達確認の回です。まず例題や解説を見ずに取り組み、最後に自分の説明を確かめましょう。この結果だけで習熟を判定することはありません。紙で取り組む場合は、問題PDFの例題を隠して使ってください。
                      </p>
                    )}
                    {!exampleOpen && (
                      <button
                        className="secondary-button"
                        onClick={() => setExampleOpen(true)}
                      >
                        例題をひらく
                      </button>
                    )}
                    {exampleOpen && (
                      <>
                        <p>{workbook.lesson.rule}</p>
                        <p className="math example-math">{workbook.lesson.example}</p>
                        <ExplanationSteps steps={workbook.lesson.steps} />
                      </>
                    )}
                  </div>
                </section>
                {result && (
                  <section className="result-summary" aria-live="polite">
                    <div>
                      <p className="eyebrow">
                        {revealed ? "ANSWER & EXPLANATION" : "TODAY'S PRACTICE"}
                      </p>
                      <h2>
                        {revealed
                          ? "解答と解説を確認しよう。"
                          : result.total + "問中" + result.correctCount + "問正解"}
                      </h2>
                      <p>
                        {revealed
                          ? "解説を読んだら、もう一度自分の手で確かめてみましょう。"
                          : result.correctCount === result.total
                            ? "今回のセットを解き終えました。今日はここまででも大丈夫。"
                            : "解説と自分の途中式を比べて、考え方を確かめましょう。"}
                      </p>
                      <small>
                        この結果は今回の取り組みです。習熟度の判定ではありません。
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setResult(null);
                        setRevealed(false);
                      }}
                    >
                      もう一度取り組む
                      <Icon name="arrow" size={17} />
                    </button>
                  </section>
                )}
                <section className="question-list" aria-label="練習問題">
                  {workbook.items.map((item, index) => {
                    const gradeItem = result?.items.find(
                      (entry) => entry.id === item.id,
                    );
                    return (
                      <article
                        className={"question " + (gradeItem ? "graded" : "")}
                        key={item.id}
                      >
                        <div className="question-number">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="question-content">
                          <p className="question-instruction">{item.instruction}</p>
                          <h2 className="math problem-math">{item.prompt}</h2>
                          <div className="answer-row">
                            <label htmlFor={item.id}>
                              答え
                              {workbook.topicId === "equations" && (
                                <span className="math">x =</span>
                              )}
                            </label>
                            <input
                              id={item.id}
                              aria-label={"問題" + (index + 1) + "の答え"}
                              value={answers[item.id] ?? ""}
                              onChange={(event) =>
                                setAnswers((previous) => ({
                                  ...previous,
                                  [item.id]: event.target.value,
                                }))
                              }
                              disabled={!!result || busy === "grade"}
                              type="text"
                              inputMode="text"
                              autoComplete="off"
                              maxLength={64}
                              placeholder="数値を入力"
                            />
                            {gradeItem && !revealed && (
                              <span className={"answer-status " + gradeItem.status}>
                                {gradeItem.status === "correct"
                                  ? "正解"
                                  : gradeItem.status === "unanswered"
                                    ? "未解答"
                                    : gradeItem.status === "invalid"
                                      ? "入力を確認"
                                      : "もう一度確認"}
                              </span>
                            )}
                          </div>
                          {gradeItem && (
                            <div className="answer-explanation">
                              <strong>
                                答え{" "}
                                <span className="math">
                                  {workbook.topicId === "equations" ? "x = " : ""}
                                  {gradeItem.answer}
                                </span>
                              </strong>
                              <ExplanationSteps steps={gradeItem.steps} />
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </section>
                {!result && (
                  <div className="grading-actions">
                    <span>
                      {workbook.items.filter((item) => answers[item.id]?.trim()).length}{" "}
                      / {workbook.count} 問に入力済み
                    </span>
                    <button
                      className="primary-button"
                      onClick={() => void grade()}
                      disabled={!!busy}
                    >
                      {busy === "grade" ? "確認しています…" : "答え合わせをする"}
                      <Icon name="check" />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void grade(true)}
                      disabled={!!busy}
                    >
                      解かずに解答・解説を見る
                    </button>
                  </div>
                )}
                <p className="privacy-note study-privacy">
                  問題と正解は同じ内容を再現するために保管します。入力した答え・成績・学習履歴は保存しません。画面を閉じる前に、必要なPDFをダウンロードしてください。
                </p>
              </>
            )
          )}
        </main>
        <footer className="main-footer">
          <span>Exercise Book</span>
          <p>今日の一歩を、確かな力に。</p>
          <button onClick={() => setAbout(true)}>
            体験版・教材について
            <Icon name="arrow" size={14} />
          </button>
        </footer>
      </div>
      {about && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAbout(false);
          }}
        >
          <dialog
            ref={dialog}
            className="about-dialog"
            aria-labelledby="about-title"
            onCancel={() => setAbout(false)}
          >
            <p className="eyebrow">ABOUT THIS EDITION</p>
            <h2 id="about-title">学ぶ体験を、つくっています。</h2>
            <p>
              中高生が自分に合った問題集で少しずつ進める、Exercise Bookの体験版です。
            </p>
            <ul>
              <li>正負の数・文字式の値・一次方程式の試作教材を利用できます。</li>
              <li>
                解答は数式の計算で検算しています。教材の教育的なレビューは未完了です。
              </li>
              <li>問題編と解答編のPDFをダウンロードできます。</li>
              <li>
                目標とペースから学習計画を設計し、各回の教材と新しい練習問題を作れます。学習履歴の保存・習熟度の自動判定には対応していません。
              </li>
            </ul>
            <p className="dialog-note">
              新しく作成するたびに問題の数値が変わります。作成済みの問題と正解を保管し、画面・採点・PDFで同じ内容を使います。扱う範囲は中学数学の基礎3領域です。
            </p>
            <button
              autoFocus
              className="primary-button"
              onClick={() => setAbout(false)}
            >
              閉じる
            </button>
          </dialog>
        </div>
      )}
    </div>
  );
}

function ExplanationSteps({ steps }: { steps: readonly ExplanationStep[] }) {
  return (
    <ol className="explanation-steps">
      {steps.map((step, index) => (
        <li key={index} data-relation={step.relation}>
          <span className="step-relation">
            {explanationRelationLabels[step.relation]}
          </span>
          <div className="math explanation-math">{step.math}</div>
          <p>{step.reason}</p>
        </li>
      ))}
    </ol>
  );
}

function PaperPreview({
  topic,
  count,
  level,
}: {
  topic: Topic;
  count: ProblemCount;
  level: Level;
}) {
  return (
    <div className="paper-stack" aria-hidden="true">
      <div className="paper-shadow" />
      <div className="paper">
        <div className="paper-top">
          <span>EXERCISE BOOK</span>
          <span>MATHEMATICS</span>
        </div>
        <p className="paper-kicker">自分のペースで、一歩ずつ。</p>
        <h2>{topic.title}</h2>
        <div className="paper-meta">
          <span>{level === "foundation" ? "基礎を固める" : "標準に挑戦"}</span>
          <span>{count}問</span>
        </div>
        <div className="paper-name">
          日付
          <span />
          名前
          <span />
        </div>
        <div className="paper-example">
          <span>例題と解き方</span>
          <p>{topic.lesson.rule}</p>
          <div className="math">{topic.lesson.example}</div>
        </div>
        <div className="paper-problem">
          <span>01</span>
          <div>
            <p className="math">{topic.sample}</p>
            <div className="writing-lines">
              <i />
              <i />
              <i />
            </div>
            <span className="paper-answer">答え</span>
          </div>
        </div>
        <div className="paper-bottom">
          <span>問題集をつくると、全問が表示されます。</span>
          <span>01</span>
        </div>
      </div>
      <span className="paper-tab">
        YOUR PACE.
        <br />
        YOUR PROGRESS.
      </span>
    </div>
  );
}
