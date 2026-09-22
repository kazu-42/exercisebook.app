import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import type { ProblemCount, TopicId } from "../src/contracts";
import type {
  StartingPoint,
  SyllabusGoalId,
  SyllabusPhase,
  SyllabusPlan,
  SyllabusReasonCode,
  SyllabusRequest,
  SyllabusSession,
  SyllabusSkill,
  SyllabusSkillId,
} from "../src/syllabus-contracts";

export const SYLLABUS_POLICY_VERSION = "algebra-foundation-plan@1" as const;
export const SYLLABUS_MINIMUM_REVIEW_GAP = 3;

const SKILLS: readonly SyllabusSkill[] = [
  {
    id: "signed-add-subtract",
    title: "正負の数のたし算・ひき算",
    topicId: "signed-numbers",
    level: "foundation",
    objective: "符号と絶対値を確かめて、正負の数の和と差を求める。",
    prerequisites: [],
    lessonFocus:
      "ひき算を反対の数のたし算に直し、符号が同じ場合と異なる場合を比べます。",
    reflection: "負の数をひくとき、どの数の符号を変えましたか。",
    checkpointCriteria:
      "例題を見ずに計算し、ひき算をたし算に直す理由を自分の言葉で確認する。",
  },
  {
    id: "signed-multiply-divide",
    title: "正負の数のかけ算・わり算",
    topicId: "signed-numbers",
    level: "standard",
    objective: "積と商の符号を決め、絶対値を計算する。",
    prerequisites: ["signed-add-subtract"],
    lessonFocus:
      "同符号と異符号の計算を比べ、わり算の結果をかけ算で確かめます。0 ではわれません。",
    reflection: "計算を始める前に、答えの符号を決められましたか。",
    checkpointCriteria:
      "符号の異なるかけ算・わり算を区別し、商を逆のかけ算で確認する。",
  },
  {
    id: "substitute-positive",
    title: "文字に正の数を代入する",
    topicId: "expressions",
    level: "foundation",
    objective: "文字に数を当てはめ、かけ算を先にして式の値を求める。",
    prerequisites: ["signed-add-subtract"],
    lessonFocus:
      "2x は 2 と x の積です。文字を指定された数に置き換えてから、計算の順序を確かめます。",
    reflection: "文字に数を入れる操作と、その後の計算を分けて書けましたか。",
    checkpointCriteria: "指定された値を正しく代入し、かけ算とたし算の順序を説明する。",
  },
  {
    id: "substitute-negative",
    title: "文字に負の数を代入する",
    topicId: "expressions",
    level: "standard",
    objective: "負の数を括弧で囲んで代入し、符号を保って式の値を求める。",
    prerequisites: [
      "signed-add-subtract",
      "signed-multiply-divide",
      "substitute-positive",
    ],
    lessonFocus: "負の数を代入するときは括弧を使い、係数との積の符号を先に確かめます。",
    reflection: "負の数を代入した場所に括弧を付け、計算の符号を確認できましたか。",
    checkpointCriteria:
      "負の係数や負の代入値でも、括弧を使った途中式と答えを確認する。",
  },
  {
    id: "equation-positive",
    title: "等式の性質で方程式を解く",
    topicId: "equations",
    level: "foundation",
    objective: "両辺に同じ操作をして x の値を求め、元の式で確かめる。",
    prerequisites: ["substitute-positive"],
    lessonFocus:
      "両辺から同じ数をひき、0 でない同じ数でわります。元に戻せる操作では解が変わりません。",
    reflection: "両辺にどんな操作をしたか、途中式に沿って説明できましたか。",
    checkpointCriteria:
      "両辺への操作を説明して解き、代入すると左右が等しくなることを確かめる。",
  },
  {
    id: "equation-signed",
    title: "負の係数・負の解がある方程式",
    topicId: "equations",
    level: "standard",
    objective: "負の数を含む ax + b = c を解き、解の符号を代入で確かめる。",
    prerequisites: [
      "signed-add-subtract",
      "signed-multiply-divide",
      "equation-positive",
    ],
    lessonFocus:
      "負の係数でわるときも、両辺に同じ操作をします。求めた値は元の方程式に代入します。",
    reflection: "負の数でわったときの符号と、元の式での確認を説明できましたか。",
    checkpointCriteria:
      "負の係数・負の解でも両辺の等しさを保って解き、元の式で検算する。",
  },
];

const GOALS: Readonly<
  Record<
    SyllabusGoalId,
    {
      title: string;
      description: string;
      skillCount: number;
      topicId: TopicId;
    }
  >
> = {
  "signed-number-confidence": {
    title: "正負の数の計算に自信をつける",
    description:
      "整数のたし算・ひき算から、符号を含むかけ算・わり算まで順に取り組みます。",
    skillCount: 2,
    topicId: "signed-numbers",
  },
  "expression-values": {
    title: "文字式の値を求められるようにする",
    description: "正負の数を復習し、正の数と負の数を文字に代入する練習へ進みます。",
    skillCount: 4,
    topicId: "expressions",
  },
  "linear-equations": {
    title: "一次方程式の基本を身につける",
    description:
      "正負の数と代入を準備し、整数の ax + b = c を解いて確かめるところまで計画します。",
    skillCount: 6,
    topicId: "equations",
  },
};

const STARTING_POINTS: Readonly<
  Record<
    StartingPoint,
    {
      label: string;
      explanation: string;
      phases: readonly SyllabusPhase[];
    }
  >
> = {
  "from-basics": {
    label: "はじめから学ぶ",
    explanation:
      "自己申告に合わせて例題と練習を分けます。習得状況はまだ確認していません。",
    phases: ["introduce", "practice", "review", "checkpoint"],
  },
  "some-familiarity": {
    label: "習ったことはある",
    explanation:
      "自己申告をもとに例題と練習を一回にまとめます。前提の内容を省略せず、習得済みとは判定しません。",
    phases: ["introduce", "review", "checkpoint"],
  },
  review: {
    label: "復習したい",
    explanation:
      "自己申告をもとにまず自分で解き、必要な説明を確かめます。前提の内容も含め、習得済みとは判定しません。",
    phases: ["practice", "review", "checkpoint"],
  },
};

const PHASE_LABELS: Readonly<Record<SyllabusPhase, string>> = {
  introduce: "例題から学ぶ",
  practice: "自分で練習する",
  review: "間をあけて復習する",
  checkpoint: "説明を見ずに確かめる",
};

function invalidRequest(): never {
  throw new TypeError("学習計画の条件を確認してください。");
}

/** Read only own plain data properties, never accessors or unknown fields. */
export function parseSyllabusRequest(value: unknown): SyllabusRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalidRequest();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidRequest();
  const fields = ["goalId", "startingPoint", "weeks", "dailyMinutes"];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  )
    invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of fields) {
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      invalidRequest();
  }
  const goalId: unknown = descriptors.goalId?.value;
  const startingPoint: unknown = descriptors.startingPoint?.value;
  const weeks: unknown = descriptors.weeks?.value;
  const dailyMinutes: unknown = descriptors.dailyMinutes?.value;
  if (
    goalId !== "signed-number-confidence" &&
    goalId !== "expression-values" &&
    goalId !== "linear-equations"
  )
    invalidRequest();
  if (
    startingPoint !== "from-basics" &&
    startingPoint !== "some-familiarity" &&
    startingPoint !== "review"
  )
    invalidRequest();
  if (weeks !== 2 && weeks !== 4 && weeks !== 6) invalidRequest();
  if (dailyMinutes !== 10 && dailyMinutes !== 15 && dailyMinutes !== 20)
    invalidRequest();
  return { goalId, startingPoint, weeks, dailyMinutes };
}

type Progress = {
  readonly skill: SyllabusSkill;
  readonly order: number;
  nextPhase: number;
  previous: SyllabusSession | undefined;
};

function sessionBudget(
  request: SyllabusRequest,
  phase: SyllabusPhase,
): {
  count: ProblemCount;
  budget: SyllabusSession["budget"];
} {
  const firstExplanation =
    phase === "introduce" && request.startingPoint === "from-basics";
  const count: ProblemCount =
    request.dailyMinutes === 10
      ? 4
      : request.dailyMinutes === 15
        ? firstExplanation
          ? 4
          : 6
        : firstExplanation
          ? 6
          : 8;
  const lessonMinutes =
    phase === "checkpoint"
      ? 0
      : firstExplanation && request.dailyMinutes > 10
        ? request.dailyMinutes === 15
          ? 3
          : 4
        : 1;
  const practiceMinutes = count * 2;
  const reflectionMinutes = request.dailyMinutes === 10 ? 1 : 2;
  return {
    count,
    budget: {
      lessonMinutes,
      practiceMinutes,
      reflectionMinutes,
      totalMinutes: lessonMinutes + practiceMinutes + reflectionMinutes,
    },
  };
}

function instructionsFor(phase: SyllabusPhase): readonly string[] {
  switch (phase) {
    case "introduce":
      return [
        "短い説明と例題で考え方を確かめる。",
        "問題に取り組み、解答・解説で途中式を比べる。",
        "時間が来たら区切り、気になるところを一つ残す。",
      ];
    case "practice":
      return [
        "まず自分で問題を解く。困ったら例題を確かめる。",
        "答え合わせで、符号や操作の理由まで振り返る。",
        "残り時間で一つ確かめ直し、今日はここで終える。",
      ];
    case "review":
      return [
        "前回の答えを見ずに、考え方を思い出して解く。",
        "解説と比べて、忘れていた点を一つ確認する。",
        "解けなかった分を今日の時間に上乗せしない。",
      ];
    case "checkpoint":
      return [
        "例題や解答PDFを開く前に、自分で取り組む。",
        "答え合わせの後に解説を読み、できた点と迷った点を分ける。",
        "今回の結果だけで、定着したとは決めない。",
      ];
  }
}

function reasonFor(
  request: SyllabusRequest,
  skill: SyllabusSkill,
  phase: SyllabusPhase,
): { reasonCode: SyllabusReasonCode; reason: string } {
  if (phase === "review")
    return {
      reasonCode: "spaced-review",
      reason: "前回から学習日の枠を三つ以上あけ、考え方を思い出す機会を置きました。",
    };
  if (phase === "checkpoint")
    return {
      reasonCode: "independent-check",
      reason:
        "練習から間をあけ、説明を見ずに取り組む確認の回です。結果は習得の断定に使いません。",
    };
  if (phase === "practice")
    return request.startingPoint === "review"
      ? {
          reasonCode: "starting-point-review",
          reason:
            "復習したいという自己申告に合わせ、まず自分で解く回から始めます。前提の内容も確かめます。",
        }
      : {
          reasonCode: "guided-practice",
          reason: "例題で学んだ考え方を、別の問題で自分で使う回です。",
        };
  return skill.topicId === GOALS[request.goalId].topicId
    ? {
        reasonCode: "goal-introduction",
        reason: "選んだ目標につながる考え方を、短い説明と例題から学びます。",
      }
    : {
        reasonCode: "prerequisite-introduction",
        reason: "目標の学習を支える計算や考え方を、先に準備する回です。",
      };
}

function makeSession(
  request: SyllabusRequest,
  progress: Progress,
  phase: SyllabusPhase,
  index: number,
): SyllabusSession {
  const { skill } = progress;
  return {
    id: `session-${String(index).padStart(2, "0")}`,
    index,
    week: Math.floor((index - 1) / 5) + 1,
    day: (((index - 1) % 5) + 1) as SyllabusSession["day"],
    phase,
    skillId: skill.id,
    topicId: skill.topicId,
    level: skill.level,
    title: `${skill.title} · ${PHASE_LABELS[phase]}`,
    objective: skill.objective,
    lessonFocus: skill.lessonFocus,
    instructions: instructionsFor(phase),
    reflection: skill.reflection,
    checkpointCriteria: skill.checkpointCriteria,
    ...sessionBudget(request, phase),
    ...reasonFor(request, skill, phase),
    reviewOfSessionId:
      phase === "review" || phase === "checkpoint"
        ? (progress.previous?.id ?? null)
        : null,
  };
}

/** Plans learning actions; it neither generates assignments nor claims evidence. */
export async function planSyllabus(value: unknown): Promise<SyllabusPlan> {
  const request = parseSyllabusRequest(value);
  const goal = GOALS[request.goalId];
  const startingPoint = STARTING_POINTS[request.startingPoint];
  const skills = structuredClone(SKILLS.slice(0, goal.skillCount));
  const progress: Progress[] = skills.map((skill, order) => ({
    skill,
    order,
    nextPhase: 0,
    previous: undefined,
  }));
  const byId = new Map<SyllabusSkillId, Progress>(
    progress.map((entry) => [entry.skill.id, entry]),
  );
  const sessions: SyllabusSession[] = [];

  for (let index = 1; index <= request.weeks * 5; index += 1) {
    const candidates = progress.flatMap((entry) => {
      const phase = startingPoint.phases[entry.nextPhase];
      if (!phase) return [];
      if (entry.skill.prerequisites.some((id) => !byId.get(id)?.previous)) return [];
      const delayed = phase === "review" || phase === "checkpoint";
      const eligibleAt = entry.previous
        ? entry.previous.index + (delayed ? SYLLABUS_MINIMUM_REVIEW_GAP : 1)
        : 1;
      if (index < eligibleAt) return [];
      const priority =
        entry.nextPhase === 0
          ? 3
          : phase === "practice"
            ? 0
            : phase === "review"
              ? 1
              : 2;
      return [{ entry, phase, priority, eligibleAt }];
    });
    candidates.sort(
      (left, right) =>
        left.priority - right.priority ||
        left.eligibleAt - right.eligibleAt ||
        left.entry.order - right.entry.order,
    );
    const selected = candidates[0];
    // A deliberate unassigned day preserves spacing without prescribing filler.
    if (!selected) continue;
    const session = makeSession(request, selected.entry, selected.phase, index);
    sessions.push(session);
    selected.entry.previous = session;
    selected.entry.nextPhase += 1;
  }

  const remainingSkillIds = progress
    .filter((entry) => entry.nextPhase < startingPoint.phases.length)
    .map((entry) => entry.skill.id);
  const payload: Omit<SyllabusPlan, "id" | "planHash"> = {
    schemaVersion: "studio-syllabus-v1",
    policyVersion: SYLLABUS_POLICY_VERSION,
    request,
    saved: false,
    studyDaysPerWeek: 5,
    title: `${request.weeks}週間で取り組む、${goal.title}`,
    goal: { id: request.goalId, title: goal.title, description: goal.description },
    startingPoint: {
      id: request.startingPoint,
      label: startingPoint.label,
      explanation: startingPoint.explanation,
      evidence: "self-report",
    },
    skills,
    sessions,
    coverage: {
      status: remainingSkillIds.length ? "partial" : "planned",
      plannedSkillIds: progress
        .filter((entry) => entry.previous)
        .map((entry) => entry.skill.id),
      remainingSkillIds,
      explanation: remainingSkillIds.length
        ? "この期間に収まる学習を計画しました。残りの内容や、間をあけた確認は次の期間へ続きます。"
        : "目標の範囲に、練習・間をあけた復習・確認を配置しました。計画に入ったことと、習得したことは別です。",
    },
    limitations: [
      "週5日を上限にした計画です。空いている日は休息や追いつく日に使い、問題を増やしません。",
      "学習時間は目安です。例題・練習・振り返りを含めて区切り、終わらなかった分を当日に上乗せしません。",
      "開始地点は自己申告です。学習履歴を保存したり、実際の理解度に応じて自動調整したりする機能ではありません。",
      "復習の間隔は計画上の学習日です。実際に経過した日数や定着を確認した記録ではありません。",
      "対象は整数の計算、ax + b の値、ax + b = c の整数解です。文字式の整理・文章題・中高数学全体を網羅しません。",
      "問題は各回を始める操作で作成します。この計画だけでは問題集や学習記録は作成されません。",
    ],
  };
  const planHash = await sha256Hex(canonicalizeJson(payload));
  return { ...payload, id: `syllabus-${planHash}`, planHash };
}
