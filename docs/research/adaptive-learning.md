# 適応学習と日次プリントの設計

確認日: 2026-07-19

## Executive summary

全学年・全分野へ拡張できる共通基盤は最初から設計します。ただし、公開 MVP の教材は 30-50 個程度の skill / knowledge component からなる狭い縦切りに限定します。

最初の候補は、小学校の分数から中学校の比例・一次方程式へつながる数学領域です。全分野を一度に埋めると、問題数ではなく、次の品質保証が先に破綻します。

- 問題と解答の正しさ
- skill の粒度
- prerequisite の妥当性
- 誤答診断
- worked example と段階的 hint
- Web / print / accessibility の同等性
- 出典とライセンス
- 習得判定の妥当性

中心に置くのは、学年別の一直線な course tree ではなく、次の二つです。

1. **Goal graph**: 本人の目標、期限、使える時間、興味、到達水準から target skill を決め、hard prerequisite closure を取る。
2. **Daily adaptive frontier**: 期限の来た復習、前提の穴、目標へ進む新規 skill、異なる表現・文脈への転移を時間予算内で混ぜる。

学年は説明・検索・standards mapping の metadata として残しますが、進行を lock する唯一の軸にはしません。興味や目標は題材・順序・選択肢を変えられますが、hard prerequisite、年齢安全性、測定したい構成概念を暗黙に消してはいけません。

## 「習得」をどう扱うか

Mastery learning の原型は、形成的評価、補充学習、再評価の loop です。[Bloom の Learning for Mastery](https://eric.ed.gov/?id=ED053419) と、肯定的な [mastery learning の meta-analysis](https://doi.org/10.3102/00346543060002265) がある一方、[standardized test での効果が限定的という review](https://eric.ed.gov/?id=ED294891) もあります。

そのため Exercise Book は、次を区別します。

- 直前に見た同型問題を解けた
- hint を使って解けた
- 再試行で解けた
- 初回・無ヒントで解けた
- 時間を置いて思い出せた
- 表現や文脈が変わっても使えた

`mastered` は学習者の中に存在する真理ではなく、特定の目的に対する不確実な推論です。状態名、証拠、policy version、uncertainty を一緒に保存します。

## MVP の learner model

最初から BKT や neural model を導入せず、説明可能な状態機械と evidence ledger を使います。

```text
unseen
  -> learning
  -> provisional
  -> mastered
  -> review_due
  -> mastered

learning / provisional / mastered / review_due
  -> relearning
```

初期 policy の例:

- 別 template family 2 種以上
- 別 session 2 回以上
- first-attempt / no-hint correct を 3 件以上
- 翌日または 3 日後の delayed probe
- delayed probe を通って初めて `mastered`

これは科学的に確定した普遍的な閾値ではありません。`mastery-policy@v1` のように version を付け、false mastery、保持、転移を測って変更します。

初期の review interval は `1, 3, 7, 14, 30 日` のような保守的な列から始められます。ただし最適な spacing は保持したい期間で変わります。[Cepeda らの spacing と test delay の研究](https://pubmed.ncbi.nlm.nih.gov/19076480/) を踏まえ、固定値を「脳科学で決まった正解」とは表現しません。

## 毎日の選定

初期の 10-20 分セットでは、次のような配分を default として検証します。

| Bucket | 初期比率 | 目的 |
|---|---:|---|
| due retrieval | 35% | 忘れる前後の検索練習 |
| prerequisite repair | 20% | 目標 skill を阻害している前提の補修 |
| goal frontier | 35% | 目標への経路上で unlock 済みの新規・発展 |
| transfer / choice | 10% | 異なる表現、文脈、本人の興味、少量の探索 |

比率は初期運用値です。研究で保証された黄金比ではありません。

候補 item の score は、説明可能な feature の和で十分です。

```text
score =
  due_urgency
  + goal_distance_weight
  + evidence_gap
  + spacing_benefit
  + diversity_bonus
  + learner_choice_bonus
  - recent_exposure
  - fatigue_cost
```

選択順:

1. 期限の来た retrieval
2. target への hard prerequisite 上の弱点
3. unlock 済み goal frontier
4. interleaved transfer と本人の choice

予測正答率 70-85% 程度を中心にし、少量の stretch を混ぜることは実務的な初期値です。ただし「ZPD を科学的に測定した」とは主張しません。

## 学習科学から採用する機構

- **Retrieval practice**: 読み直しだけでなく、思い出す機会を作る。[test-enhanced learning](https://doi.org/10.1111/j.1467-9280.2006.01693.x)
- **Distributed practice**: 同じ日に固めず、時間を空けて再び問う。[distributed practice meta-analysis](https://pubmed.ncbi.nlm.nih.gov/16719566/)
- **Interleaving**: 同じ手順の block だけでなく、どの方法を使うか選ぶ練習を混ぜる。[mathematics classroom study](https://eric.ed.gov/?id=EJ1071568)
- **Successive relearning**: 検索成功と spacing を組み合わせる。[review](https://doi.org/10.1177/09637214221100484)
- **Worked example と fading**: 新規 skill では解法を見せ、徐々に支援を減らす。
- **Immediate, diagnostic feedback**: 正誤だけでなく、次の一手と誤概念への経路を示す。

学習技法全体の比較には [Dunlosky らの review](https://doi.org/10.1177/1529100612453266) を参照します。

## Skill graph

### Edge type

```ts
type SkillEdgeType =
  | "hard_prerequisite"
  | "recommended_before"
  | "related"
  | "part_of"
  | "supports";
```

- `hard_prerequisite` だけを DAG とします。
- `related`、`part_of`、`supports` は循環を許します。
- standards document の上下関係を prerequisite とみなしません。
- edge には source、reviewer、confidence、revision を持たせます。

MVP では D1 の edge table と recursive query、または application layer の traversal で十分です。graph database は不要です。

### Skill の粒度

skill は、少なくとも次を満たす単位にします。

- 観察可能な objective と evidence statement がある。
- 複数の template family で測れる。
- 隣の skill と異なる instruction / feedback を必要とする。
- 1 問の表面形式ではなく、再利用可能な知識・手続き・判断を表す。

Knowledge-Learning-Instruction framework は、知識の種類によって有効な instruction が異なると整理しています。[KLI framework](https://doi.org/10.1111/j.1551-6709.2012.01245.x)

pilot 後は、skill ごとの learning curve、error pattern、transfer を見て merge / split します。CMU DataShop の [research goals](https://pslcdatashop.web.cmu.edu/ResearchGoals) と [Learning Factors Analysis](https://pact.cs.cmu.edu/koedinger/pubs/Cen%2C%20Koedinger%20%26%20Junker06.pdf) が参考になります。

## Canonical data model

### Curriculum and goals

- `framework`: source、version、jurisdiction、locale
- `standard`: internal ID、framework ID、official code / GUID、label、description
- `skill`: objective、domain、locale、grade band、cognitive demand、evidence statement
- `skill_edge`: from、to、type、confidence、source、reviewer、revision
- `goal`: desired level、deadline、priority、interests、minutes per day、locale、accommodation
- `goal_skill`: goal と target skill の relation

### Content and generated items

- `learning_object`: explanation、worked example、hint、simulation、project
- `item_template`: parameter schema、generator、constraints、scorer、solution model、misconception、difficulty、estimated time、modality
- `item_instance`: exact prompt、answer、solution、seed、template revision、hash
- `license_record`: source URL、edition、hash、attribution、license、restriction
- `quality_review`: correctness、pedagogy、bias、accessibility、reviewer、field statistics

### Learning evidence

- `attempt`: first response、hint、retry、score、mode、confidence、latency、scorer version
- `learner_skill_state`: state、evidence counts、last seen、next due、interval、lapses、uncertainty、policy version
- `daily_plan`: input snapshot、selection reason、time budget、seed、selected instance、policy version

`item_instance` は学習者へ提示する前に保存します。後から template や generator が更新されても、当時の問題と採点条件を復元できる必要があります。

## Generator と planner の不変条件

1. 問題、正答、解法は同じ AST / computation graph から生成する。
2. seed と全 version から完全再現できる。
3. exact instance を提示前に永続化する。
4. hard prerequisite を mastery 経路で飛ばさない。preview / diagnostic は明示する。
5. mastery には複数 family、複数 session、delayed no-hint evidence が必要。
6. hinted / retried correct と first-attempt / no-hint correct を区別する。
7. practice と unassisted mastery probe を区別する。
8. due review と transfer を含めつつ、時間・量を hard cap する。
9. 誤答を同型 clone の追加だけで処理せず、misconception と prerequisite へ route する。
10. invalid / ambiguous item は void でき、その attempt で state を更新しない。
11. exact instance の不用意な再出題と、答え位置などの cue leakage を検査する。
12. 本人へ「なぜ今日これが出たか」を説明できる。
13. accommodation を能力の proxy にしない。
14. locale、license、accessibility、print / web capability を通った asset だけを選ぶ。
15. bank が薄い場合は approved fixed item または verified generator へ fallback する。
16. 人口属性を能力推定の shortcut に使わない。

## 高度な model を導入する gate

### Bayesian Knowledge Tracing

古典 BKT は `P(L0)`, `P(T)`, `P(G)`, `P(S)` を持つ、比較的説明しやすい model です。[Corbett and Anderson](https://doi.org/10.1007/BF01099821)

導入条件:

- skill / KC tag が field data で安定している。
- 各 skill に十分な観測がある。
- hint、retry、family、delay が event に残っている。
- calibration と delayed probe への一致を評価できる。

古典形の binary latent state、KC 分割への依存、forgetting の扱いなどに限界があります。[BKT の性質と限界](https://files.eric.ed.gov/fulltext/EJ1115329.pdf)

### IRT / CAT

IRT は item difficulty と learner ability を分けて扱うのに有用ですが、十分な sample、anchor item、equating、local independence が必要です。[ETS introduction to IRT](https://www.ets.org/research/policy_research_reports/publications/report/2020/kbxx.html)

同じ template の parameter だけを変えた大量の近縁 item は、独立した校正 item とみなしません。template family による local dependence を考慮します。

### DKT / reinforcement learning / bandit

[Deep Knowledge Tracing](https://proceedings.neurips.cc/paper/2015/hash/bac9162b47c56fc8a4d2a519803d51b3-Abstract.html) は next response prediction を改善し得ますが、解釈性、simple baseline との差、知識状態の一貫性に批判があります。

- [How Deep is Knowledge Tracing?](https://arxiv.org/abs/1604.02416)
- [Knowledge tracing models' predictive performance and consistency](https://arxiv.org/abs/2101.11335)

next-answer AUC、滞在時間、連続日数だけを reward にすると、学びではなく「当たりやすさ」や「離脱しにくさ」を最適化します。delayed retention、transfer、false mastery、安全性を reward / guardrail にできるまで導入しません。

## 評価

### 学習 outcome

- 7 日後、30 日後の delayed retention
- 未見 template / 異なる文脈への transfer
- goal attainment と mastery あたりの学習時間
- first-attempt / no-hint performance
- mastered 後の delayed probe failure、つまり false mastery

### Model and item quality

- Brier score、log loss、skill 別 calibration curve
- false mastery / false non-mastery
- item / template difficulty、discrimination、distractor efficiency
- exposure、duplicate、generator rejection、invalid rate
- template family coverage、orphan skill、prerequisite closure
- sample が十分な場合の DIF

### Operational and fairness

- group 別 outcome、path、difficulty exposure、error、opportunity to learn
- content defect、review coverage、license manifest completeness
- WCAG manual audit
- Web / PDF render success、latency、font / glyph error
- paper self-report と Web evidence の差

completion、return、self-report burden は guardrail であり、主目的にはしません。

変更評価には、配信 algorithm が見ていない anchor item を使った pretest / posttest / delayed posttest が必要です。adaptive selection された data だけで difficulty を再推定すると feedback loop が起きるため、少量の exploration slot と anchor を残します。

assessment validity と fairness の基本には、[ETS Standards for Quality and Fairness](https://www.ets.org/content/dam/ets-org/pdfs/about/standards-quality-fairness.pdf) と [Messick の validity framework](https://www.ets.org/research/policy_research_reports/publications/report/1994/icey.html) を使います。

## Accessibility

baseline は [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) とします。

- semantic heading、label、list、table
- keyboard access、visible focus、十分な target size
- 色だけに依存しない情報
- caption、transcript、long description
- locale、language、ruby、bidi
- 数式画像だけでなく MathML / semantic representation
- interactive item の static / print / keyboard fallback
- fluency を測らない課題で speed を mastery evidence にしない

数式は [MathML Core](https://www.w3.org/TR/mathml-core/) を Web fallback として持ちます。PDF は自動的に accessible になるわけではないため、同じ教材の semantic Web 版を canonical fallback として公開します。

## 子どもの privacy posture

これは法的助言ではありません。初期 product posture として次を採用します。

- account なしで公開教材を利用できる。
- 子どもの永続 account は parent-managed を基本とする。
- pseudonymous ID を使い、不要なら正確な生年月日を集めない。
- 広告と第三者 tracker を置かない。
- first-party telemetry も目的と保存期間を限定する。
- export / delete を提供する。
- accommodation と学力 profile を分離し、機微な教育 data として保護する。
- social、public profile、child-to-child chat を MVP に含めない。
- 地域展開前に DPIA と法務 checklist を行う。

確認先:

- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [COPPA final rule amendments](https://www.ftc.gov/legal-library/browse/federal-register-notices/16-cfr-part-312-coppa-final-rule-amendments)
- [GDPR Article 8](https://eur-lex.europa.eu/legal-content/EN-DE/TXT/?from=EN&uri=CELEX%3A32016R0679)
- [UK Children's Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code)
- [日本の個人情報保護法 Q&A](https://www.ppc.go.jp/personalinfo/faq/APPI_QA/)

## 最大の failure mode

- generator の答えや解説が誤る、または複数解になる。
- skill 粒度と prerequisite が誤り、誤診断を量産する。
- 近縁 clone の連続正解を mastery と扱う。
- cold start と少数 data を過度に個別化する。
- adaptive selection bias が difficulty 統計を自己強化する。
- engagement 最適化が curiosity、transfer、wellbeing を狭める。
- 読解負荷、文化背景、操作性を対象 skill の能力と誤認する。
- 紙の自己採点を Web の first-attempt evidence と同等に扱う。
- 将来 external contribution を受け入れると、誤答、荒らし、権利侵害が入る。
- 「全学年・全分野」という宣言が review capacity を超える。

## 推奨実装順

1. 30-50 skill の縦切り、skill graph、goal からの prerequisite closure
2. 各 skill 3 family 以上、worked example、hint、misconception、二者 review
3. deterministic generator と exact instance persistence
4. Web feedback と印刷物から同じ interactive 解説へ戻る QR
5. rule-based daily planner と selection rationale
6. WCAG、license manifest、standards mapping、item kill switch
7. pilot で defect、false mastery、7/30 日保持、transfer を測定
8. KC merge / split と policy threshold の調整
9. evidence gate を満たした場合だけ BKT、IRT/CAT を順に導入

QR payload は public/content-addressed な解説 URL、または明示的な認証後に
対象へ戻る re-entry route に限定する。learner ID、回答、accommodation、
bearer token、private artifact URL は埋め込まない。
