import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  StartingPoint,
  SyllabusGoalId,
  SyllabusPhase,
  SyllabusPlan,
  SyllabusRequest,
  SyllabusSession,
} from "./syllabus-contracts";
import { parseSyllabus, readSyllabusResponse } from "./syllabus-validation";
import "./syllabus.css";

const goals: readonly {
  id: SyllabusGoalId;
  title: string;
  detail: string;
}[] = [
  {
    id: "signed-number-confidence",
    title: "正負の数を、確かに",
    detail: "符号と計算のきまりを説明しながら、四則計算を進める。",
  },
  {
    id: "expression-values",
    title: "文字式の値を求める",
    detail: "数の計算を土台に、正の数・負の数の代入を身につける。",
  },
  {
    id: "linear-equations",
    title: "一次方程式を解く",
    detail: "等式の性質を使い、解の変わらない変形と代入の確認を学ぶ。",
  },
];

const startingPoints: readonly {
  id: StartingPoint;
  title: string;
  detail: string;
}[] = [
  {
    id: "from-basics",
    title: "はじめから学ぶ",
    detail: "前提になる内容から、例題を読んで進める。",
  },
  {
    id: "some-familiarity",
    title: "少し学んだことがある",
    detail: "既習の内容も確認しながら、練習につなげる。",
  },
  {
    id: "review",
    title: "復習から取り組む",
    detail: "学んだ内容を思い出し、日を空けて確かめる。",
  },
];

const phaseLabels: Record<SyllabusPhase, string> = {
  introduce: "例題で学ぶ",
  practice: "練習する",
  review: "日を空けて復習",
  checkpoint: "自力で確認",
};

const defaultRequest: SyllabusRequest = {
  goalId: "linear-equations",
  startingPoint: "from-basics",
  weeks: 4,
  dailyMinutes: 15,
};

export interface SyllabusBuilderProps {
  readonly busy: boolean;
  readonly onStartSession: (session: SyllabusSession) => Promise<void>;
  readonly initialPlan?: SyllabusPlan | null;
  readonly onPlanChange?: (plan: SyllabusPlan) => void;
}

function WeekPlan({
  plan,
  week,
  busy,
  onStart,
  printing = false,
}: {
  plan: SyllabusPlan;
  week: number;
  busy: boolean;
  onStart: (session: SyllabusSession) => void;
  printing?: boolean;
}) {
  const sessions = plan.sessions.filter((session) => session.week === week);
  const titles = Array.from(
    new Set(
      sessions.map(
        (session) => plan.skills.find((skill) => skill.id === session.skillId)?.title,
      ),
    ),
  ).filter(Boolean);
  return (
    <section className="syllabus-week" aria-label={`${week}週目の学習計画`}>
      <div className="syllabus-week-heading">
        <span aria-hidden="true">{String(week).padStart(2, "0")}</span>
        <div>
          <h3>
            {week}週目 · {titles.join("・") || "休息と学び直し"}
          </h3>
          <p>
            {sessions.length > 0
              ? `${sessions.length}回の学習。予定のない日は、休息や取り組めなかった回に使えます。`
              : "新しい課題はありません。ここまでの内容を振り返ったり、休息に使えます。"}
          </p>
        </div>
      </div>
      <div className="syllabus-sessions">
        {sessions.map((session) => {
          const skill = plan.skills.find((entry) => entry.id === session.skillId);
          const prerequisiteTitles = skill?.prerequisites.map(
            (id) => plan.skills.find((entry) => entry.id === id)?.title ?? id,
          );
          return (
            <article className="syllabus-session" key={session.id}>
              <span className="syllabus-session-number" aria-hidden="true">
                <small>DAY</small>
                {String(session.day).padStart(2, "0")}
              </span>
              <div className="syllabus-session-body">
                <div className="syllabus-session-meta">
                  <span className="syllabus-phase" data-phase={session.phase}>
                    {phaseLabels[session.phase]}
                  </span>
                  <span>{session.day}日目</span>
                  <span>
                    上限 {session.budget.totalMinutes}分 · {session.count}問
                  </span>
                </div>
                <h4>{session.title}</h4>
                <p className="syllabus-session-focus">{session.objective}</p>
                <dl className="syllabus-session-description">
                  <dt>学ぶこと</dt>
                  <dd>{session.lessonFocus}</dd>
                  <dt>進め方</dt>
                  <dd>{session.instructions.join(" ")}</dd>
                  {prerequisiteTitles && prerequisiteTitles.length > 0 && (
                    <>
                      <dt>前提の学び</dt>
                      <dd>{prerequisiteTitles.join("・")}</dd>
                    </>
                  )}
                  <dt>この順序の理由</dt>
                  <dd>{session.reason}</dd>
                  <dt>確認すること</dt>
                  <dd>{session.checkpointCriteria}</dd>
                  <dt>ふりかえり</dt>
                  <dd>{session.reflection}</dd>
                </dl>
                <div className="syllabus-session-footer">
                  <p>
                    例題・確認 {session.budget.lessonMinutes}分 ／ 練習{" "}
                    {session.budget.practiceMinutes}分 ／ ふりかえり{" "}
                    {session.budget.reflectionMinutes}分
                    <br />
                    時間になったら区切り、続きは別の日に取り組めます。
                  </p>
                  {!printing && (
                    <button
                      className="syllabus-button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => onStart(session)}
                      aria-label={`${week}週目・${session.day}日目の学習を始める`}
                    >
                      この回を始める
                    </button>
                  )}
                </div>
                {printing && (
                  <div className="syllabus-print-reflection">
                    ふりかえり・次に確かめたいこと：
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function SyllabusBuilder({
  busy,
  onStartSession,
  initialPlan = null,
  onPlanChange,
}: SyllabusBuilderProps) {
  const [conditions, setConditions] = useState<SyllabusRequest>(
    initialPlan?.request ?? defaultRequest,
  );
  const [plan, setPlan] = useState<SyllabusPlan | null>(initialPlan);
  const [week, setWeek] = useState(1);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [planChanged, setPlanChanged] = useState(false);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const sessionLock = useRef(false);
  const locked = busy || planning || starting;

  useEffect(() => {
    return () => {
      operation.current += 1;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (planChanged) planHeading.current?.focus();
  }, [plan, planChanged]);

  async function buildPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const token = ++operation.current;
    const requested = { ...conditions };
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
    setPlanning(true);
    setError("");
    try {
      const response = await fetch("/studio-api/syllabi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requested),
        signal,
      });
      const next = parseSyllabus(
        await readSyllabusResponse(response, signal),
        requested,
      );
      if (token !== operation.current) return;
      setPlan(next);
      setWeek(1);
      setPlanChanged(true);
      onPlanChange?.(next);
    } catch {
      if (token === operation.current)
        setError(
          "学習計画を作成できませんでした。条件と前の計画は残っています。少し待ってから、もう一度お試しください。",
        );
    } finally {
      if (token === operation.current) {
        setPlanning(false);
        controller.current = null;
      }
    }
  }

  async function startSession(session: SyllabusSession) {
    if (locked || sessionLock.current) return;
    sessionLock.current = true;
    setStarting(true);
    setError("");
    try {
      await onStartSession(session);
    } catch {
      setError(
        "この回の教材を準備できませんでした。学習計画は残っています。もう一度お試しください。",
      );
    } finally {
      sessionLock.current = false;
      setStarting(false);
    }
  }

  function downloadPlan() {
    if (!plan) return;
    try {
      const blob = new Blob([JSON.stringify(plan, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `exercisebook-syllabus-${plan.planHash.slice(0, 12)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setError(
        "計画データを保存できませんでした。画面の学習計画はそのまま確認できます。",
      );
    }
  }

  function printPlan() {
    const cleanup = () =>
      document.documentElement.classList.remove("syllabus-printing");
    document.documentElement.classList.add("syllabus-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    try {
      window.print();
    } catch {
      setError("印刷画面を開けませんでした。計画データの保存も利用できます。");
    } finally {
      cleanup();
      window.removeEventListener("afterprint", cleanup);
    }
  }

  return (
    <div className="syllabus-builder">
      <header className="syllabus-heading">
        <span className="syllabus-eyebrow">中1数学 · 学習計画</span>
        <h1>学びを、順序から設計する。</h1>
        <p>
          何を、なぜ、この順番で学ぶのか。目標と学習時間から、例題・練習・復習・自力での確認を組み合わせます。
        </p>
      </header>

      <form
        className="syllabus-form"
        onSubmit={(event) => void buildPlan(event)}
        aria-busy={planning}
      >
        <h2>目標とペースを決める</h2>
        <p className="syllabus-form-intro">
          まずは中1数学の計算分野から。前提になる内容も計画に含めます。
        </p>

        <fieldset className="syllabus-fieldset" disabled={locked}>
          <legend>どこまで学びたいですか</legend>
          <div className="syllabus-goals">
            {goals.map((goal, index) => (
              <label className="syllabus-choice" key={goal.id}>
                <input
                  type="radio"
                  name="syllabus-goal"
                  value={goal.id}
                  checked={conditions.goalId === goal.id}
                  onChange={() => setConditions({ ...conditions, goalId: goal.id })}
                />
                <span className="syllabus-choice-content">
                  <span className="syllabus-choice-index" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <strong>{goal.title}</strong>
                  <span className="syllabus-choice-detail">{goal.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="syllabus-fieldset" disabled={locked}>
          <legend>今の学習経験</legend>
          <div className="syllabus-options starting-points">
            {startingPoints.map((point) => (
              <label className="syllabus-choice" key={point.id}>
                <input
                  type="radio"
                  name="syllabus-starting-point"
                  value={point.id}
                  checked={conditions.startingPoint === point.id}
                  onChange={() =>
                    setConditions({ ...conditions, startingPoint: point.id })
                  }
                />
                <span className="syllabus-choice-content">
                  <strong>{point.title}</strong>
                  <span className="syllabus-choice-detail">{point.detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="syllabus-note">
            自己申告をもとにした出発点です。理解度や習得済みの判定には使いません。
          </p>
        </fieldset>

        <div className="syllabus-budget">
          <fieldset className="syllabus-fieldset" disabled={locked}>
            <legend>計画する期間</legend>
            <div className="syllabus-options">
              {([2, 4, 6] as const).map((weeks) => (
                <label className="syllabus-choice" key={weeks}>
                  <input
                    type="radio"
                    name="syllabus-weeks"
                    value={weeks}
                    checked={conditions.weeks === weeks}
                    onChange={() => setConditions({ ...conditions, weeks })}
                  />
                  <span className="syllabus-choice-content">
                    <strong>{weeks}週間</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="syllabus-fieldset" disabled={locked}>
            <legend>1日の学習時間の上限</legend>
            <div className="syllabus-options">
              {([10, 15, 20] as const).map((dailyMinutes) => (
                <label className="syllabus-choice" key={dailyMinutes}>
                  <input
                    type="radio"
                    name="syllabus-minutes"
                    value={dailyMinutes}
                    checked={conditions.dailyMinutes === dailyMinutes}
                    onChange={() => setConditions({ ...conditions, dailyMinutes })}
                  />
                  <span className="syllabus-choice-content">
                    <strong>{dailyMinutes}分</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="syllabus-form-bottom">
          <p className="syllabus-note">
            週5日まで・1日{conditions.dailyMinutes}分まで。
            <br />
            予定のない日は、休息や学び直しに。
          </p>
          <button className="syllabus-button" type="submit" disabled={locked}>
            {planning
              ? "学習の順序を組み立てています…"
              : plan
                ? "この条件で計画を組み直す"
                : "この条件で学習計画をつくる"}
          </button>
        </div>
      </form>

      {error && (
        <p className="syllabus-alert" role="alert">
          {error}
        </p>
      )}

      {plan && (
        <section className="syllabus-plan" aria-labelledby="syllabus-plan-title">
          <div className="syllabus-plan-heading">
            <div className="syllabus-plan-heading-row">
              <div>
                <span className="syllabus-eyebrow">あなたの学習計画</span>
                <h2 ref={planHeading} id="syllabus-plan-title" tabIndex={-1}>
                  {plan.title}
                </h2>
                <p>{plan.goal.description}</p>
              </div>
              <div className="syllabus-plan-tools">
                <button
                  type="button"
                  className="syllabus-button secondary"
                  onClick={printPlan}
                  disabled={locked}
                >
                  計画を印刷
                </button>
                <button
                  type="button"
                  className="syllabus-button secondary"
                  onClick={downloadPlan}
                  disabled={locked}
                >
                  計画データを保存
                </button>
              </div>
            </div>
            <div className="syllabus-statline">
              <span>
                <strong>{plan.request.weeks}</strong>週間
              </span>
              <span>
                <strong>{plan.sessions.length}</strong>回の学習
              </span>
              <span>
                1日 <strong>{plan.request.dailyMinutes}</strong>分まで
              </span>
              <span>{plan.startingPoint.label}から</span>
            </div>
          </div>
          <div className="syllabus-scope">
            <h3>
              {plan.coverage.status === "partial"
                ? "この期間で取り組む範囲"
                : "計画に含まれる学び"}
            </h3>
            <p className="syllabus-note">{plan.coverage.explanation}</p>
            {plan.coverage.remainingSkillIds.length > 0 && (
              <p className="syllabus-note">
                次の計画で続ける内容：
                {plan.coverage.remainingSkillIds
                  .map(
                    (id) => plan.skills.find((skill) => skill.id === id)?.title ?? id,
                  )
                  .join("・")}
              </p>
            )}
            <p className="syllabus-note">{plan.startingPoint.explanation}</p>
            <ul>
              {plan.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
            <p className="syllabus-note">
              この計画はサーバーに保存されません。ページを閉じる前に、印刷または計画データの保存をご利用ください。データの読み込み機能は準備中です。
            </p>
          </div>

          <div className="syllabus-week-switcher" role="group" aria-label="表示する週">
            {Array.from({ length: plan.request.weeks }, (_, index) => index + 1).map(
              (number) => (
                <button
                  className="syllabus-week-button"
                  type="button"
                  key={number}
                  aria-pressed={week === number}
                  onClick={() => setWeek(number)}
                >
                  {number}週目
                </button>
              ),
            )}
          </div>
          <div className="syllabus-screen-week">
            <WeekPlan
              plan={plan}
              week={week}
              busy={locked}
              onStart={(session) => void startSession(session)}
            />
          </div>
          <div className="syllabus-print-only" aria-hidden="true">
            {Array.from({ length: plan.request.weeks }, (_, index) => index + 1).map(
              (number) => (
                <WeekPlan
                  plan={plan}
                  week={number}
                  busy={false}
                  onStart={() => {}}
                  printing
                  key={number}
                />
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
