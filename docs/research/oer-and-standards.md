# 教材標準、OER、ライセンス

確認日: 2026-07-19

## 原則

Exercise Book は、教材を「無料で表示できる URL の集合」ではなく、正しさ、出典、改変、再配布条件を追跡できる公開資産として扱います。

次の三つは別の問題です。

1. software を利用・改変・配布できるか
2. 問題文、解説、画像、音声を利用・改変・配布できるか
3. ブランド名、logo、商標を表示できるか

OSS engine の license が permissive でも、収録問題が同じ license とは限りません。無料で閲覧できても、再配布・改変・機械変換が許されるとは限りません。

Exercise Book が新規制作する教材と project documentation の初期候補は **CC BY 4.0** です。コードは Apache-2.0 を候補とします。正式採用は repository owner の decision を必要とします。

## Canonical license record

各 asset に少なくとも次を持たせます。

```ts
type LicenseRecord = {
  assetId: string;
  license: string;
  sourceUrl: string;
  sourceRevision: string;
  sourceHash: string;
  originalAuthor: string;
  attribution: string;
  copyrightNotice?: string;
  modified: boolean;
  modificationNote?: string;
  translationOf?: string;
  commercialUse: "allowed" | "prohibited" | "unknown";
  derivatives: "allowed" | "share-alike" | "prohibited" | "unknown";
  reviewedAt: string;
  reviewer: string;
};
```

build / publish gate:

- license metadata が欠けた asset を reject
- NC、SA、ND、独自条件を明示的な compatibility policy なしで混ぜない
- attribution page と PDF attribution を自動生成
- source edition / revision / hash を固定
- 定期的に source terms の drift を監査
- third-party image、font、dataset を教材本文と別 record で追跡

[Creative Commons license overview](https://creativecommons.org/cc-licenses/) と [UNESCO OER mandate](https://www.unesco.org/en/open-educational-resources/mandate) を基本にします。

## Interoperability standards

### 1EdTech CASE 1.1

[CASE](https://www.1edtech.org/standards/case) は competency framework、item、association を GUID 付きで交換するための標準です。[CASE 1.1 specification](https://www.imsglobal.org/spec/case/v1p1)

Exercise Book の内部 skill model を CASE XML / JSON に置き換えるのではなく、version 付き import / export adapter を作ります。

- CASE GUID と internal skill ID を mapping
- framework version を保存
- association type を Exercise Book の prerequisite と自動同一視しない
- import 後に reviewer が hard prerequisite を承認

### 1EdTech QTI 3

[QTI](https://www.1edtech.org/standards/qti/index) は assessment item、test、result の交換標準です。QTI 3 は Web markup、accessibility、portable custom interaction を扱います。

用途:

- 外部 LMS / item bank との import / export
- fixed item と response processing の交換
- accessibility metadata の受け渡し
- 将来の CAT 接続

canonical authoring を QTI XML にすると、generator、solution trace、print fallback、Git review が扱いにくくなります。内部の Markdown / Content AST から QTI を export します。

- [QTI accessibility](https://www.1edtech.org/standards/qti/accessibility)
- [1EdTech CAT](https://www.1edtech.org/standards/cat)

### 日本の教育データ標準

- [文部科学省 教育データ標準](https://www.mext.go.jp/a_menu/other/data_00001.htm)
- [学習指導要領の考え方](https://www.mext.go.jp/a_menu/shotou/new-cs/idea/)
- [学習指導要領 Linked Data の community project](https://jp-cos.github.io/)

現行 version を確認し、学習指導要領 code を `standard_mapping` として保存します。community Linked Data は便利な adapter / prototype ですが、文部科学省の authority source と区別します。

重要なのは、**standards alignment と learning prerequisite は別の relation** であることです。学習指導要領上で先に掲載されていることは、認知的な hard prerequisite の証拠にはなりません。

## OER / OSS 候補

### Numbas

- [Numbas repository](https://github.com/numbas/Numbas)
- [documentation](https://docs.numbas.org.uk/en/latest/)
- engine: Apache-2.0
- 強み: 変数付き数学問題、scoring、constraint、seed、adaptive explore part

generator と question model の最有力参考実装です。public question database は central quality assurance 済みとは限らず、個々の question の license 欄を確認せずに一括取り込みしません。

### WeBWorK Open Problem Library

- [Open Problem Library](https://github.com/openwebwork/webwork-open-problem-library)
- 高校から大学数学の大規模 problem corpus
- content は主に CC BY-NC-SA 3.0 として扱う必要がある

NC / SA のため、Exercise Book の permissive corpus へ直接混ぜず、明示的な separate collection または design reference とします。

### Illustrative Mathematics

- [terms of use](https://illustrativemathematics.org/terms-of-use/)
- 2019-2021 first edition と現行版で license 条件が異なる
- first edition に CC BY 4.0 asset がある一方、現行版には CC BY-NC 4.0 がある

「Illustrative Mathematics は open」と一括判断せず、edition を freeze し、asset notice と商標条件を確認します。

### Core Knowledge Math

- [Core Knowledge Mathematics](https://www.coreknowledge.org/mathematics/)
- K-8 の curriculum spine 候補
- Illustrative Mathematics / Open Up 由来を含むため、unit / edition ごとの notice を確認

### OpenStax

- [textbook licensing information](https://help.openstax.org/s/article/Licensing-information-of-OpenStax-textbooks)
- [Exercises copyright](https://exercises.openstax.org/copyright)
- [Exercises API](https://exercises.openstax.org/api/)

高校・大学領域の教科書と問題候補です。版と item ごとに権利が異なる可能性があるため、書籍 title だけで license を推論しません。

### Siyavula

- [Siyavula open textbooks](https://www.siyavula.com/read)
- grade 4-12 の mathematics / science
- unbranded edition、branded edition、IT / CAT で条件が異なる

CC BY 3.0 の unbranded asset と、ND / closed asset を分けます。

### Global Digital Library

- [license information](https://digitallibrary.io/about/license/)
- early reading を中心とする multilingual corpus
- 多くは CC BY / CC BY-SA だが book ごとの metadata を確認

### Wikibooks

- [Wikibooks copyrights](https://en.wikibooks.org/wiki/Wikibooks:Copyrights)
- text は CC BY-SA / GFDL 系、media は file ごと
- quality と granularity が不均一

SA collection として分離し、人手 review を通します。

### Project Gutenberg

- [license and trademark policy](https://www.gutenberg.org/policy/license)
- 主に米国 public domain

public domain は国ごとに異なります。Gutenberg の trademark と distribution terms も確認します。

### PhET

- [source and license information](https://phet.colorado.edu/en/about/source-code)
- simulation と source の license が asset / version で異なる

初期は external link / approved embed を優先し、binary / source の再配布は個別確認します。

### その他

次は教育資産として有用ですが、NC または独自条件が含まれるため、reference / link / explicit silo 向きです。

- [OpenSciEd](https://openscied.org/commercial-license/)
- [Code.org curriculum commitment](https://code.org/cs/about/code-org-free-curriculum-commitment)
- [MIT OpenCourseWare](https://openlearning.mit.edu/courses-programs/mit-opencourseware)
- [OER Project terms](https://www.oerproject.com/Terms-of-use)
- [CK-12 curriculum materials license](https://info.ck12.org/curriculum-materials-license)

CK-12 の custom license には競合サービスに関係する制約があり、Exercise Book の canonical import source には不向きです。

### ASSISTments

- [ASSISTments content and curriculum](https://www.assistments.org/content-and-curriculum)
- immediate feedback と Skill Builder の product behavior が参考になる
- [large-scale randomized trial](https://doi.org/10.1177/2332858416673968)

platform が無料でも content の export / redistribution 権が同じとは限りません。source curriculum の license を継承して確認します。

## Design reference として有用な OSS

- [Khan Perseus](https://github.com/Khan/perseus): editor、renderer、grading、interactive widget
- [WeBWorK PG](https://github.com/openwebwork/pg): parameter、answer checker、solution
- [STACK](https://github.com/maths/moodle-qtype_stack): CAS、misconception 別 feedback
- [PreTeXt](https://github.com/PreTeXtBook/pretext): semantic single source から HTML、LaTeX PDF、EPUB、interactive / static exercise
- [PreTeXt interactive exercises](https://pretextbook.org/doc/guide/html/topic-interactive-exercises.html)
- [PreTeXt worksheets](https://pretextbook.org/doc/guide/html/overview-worksheet.html)

PreTeXt の「一つの意味構造から複数媒体へ出す」思想は Exercise Book に近い一方、XML + Python / XSLT toolchain を Cloudflare Worker にそのまま載せる必要はありません。Markdown を authoring surface、typed AST を中心にして同じ境界を作ります。

## Import workflow

```text
discover source
  -> identify exact asset and edition
  -> capture terms and license
  -> verify author / third-party rights
  -> hash original
  -> decide compatible collection
  -> transform into Content AST
  -> correctness / pedagogy / accessibility review
  -> attribution generation
  -> publish with source revision
  -> periodic terms drift audit
```

一括 scraper で問題文を収集し、出典だけ後から付ける手順は禁止します。権利と provenance を import より前に確認します。

## CI policy

最低限、次を自動検査します。

- missing license record
- unknown / deprecated license identifier
- ND asset の modification
- NC asset の permissive collection への混入
- SA asset の incompatible bundle への混入
- attribution 生成不能
- source URL / revision / hash 欠落
- terms review の期限切れ
- PDF attribution page と Web attribution page の差

license compatibility には法的判断が含まれるため、CI は「許可を推論する」のではなく、project owner が承認した compatibility matrix を機械的に適用します。
