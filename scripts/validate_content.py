#!/usr/bin/env python3
"""コンテンツJSONの検証器 (受け入れ基準: サンプルJSONがスキーマに適合すること).

使い方:
    python3 scripts/validate_content.py [content/samples/*.json ...]
    (引数なしなら content/samples/ 直下の全 .json を検証)

チェック2層構成:
  1. JSON Schema (content/schema/deck.schema.json) — 構造・型・必須フィールド
  2. 整合性ルール (docs/design/content-design.md §5) — Schemaで表現できない制約:
     - deck内 wordId / quizId / lessonId の一意性
     - quiz.wordId が同一deck内の語を参照していること
     - answerChoiceId が quiz.choices 内に存在すること
     - 自動生成規則 choosable deck: fill-blank 生成候補は term が
       同一スペルの別語と衝突しないこと (衝突時は explanation 必須)
     - choose-meaning ダミー3肢は同一deck内の別語から取れること
       (= deck内の語数が 4 以上、meaning の重複がないこと)
     - fill-blank の prompt に空所 ___ が含まれ、答え term が prompt 由来で
       一意に決まること (term が prompt 中空所以外の位置に現れない)
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "content" / "schema" / "deck.schema.json"
SAMPLES_DIR = ROOT / "content" / "samples"


def consistency_errors(deck: dict) -> list[str]:
    errs = []
    word_ids = []
    quiz_ids = []
    lesson_ids = []
    meanings = {}
    terms = {}
    for lesson in deck["lessons"]:
        lesson_ids.append(lesson["lessonId"])
        for w in lesson["words"]:
            word_ids.append(w["wordId"])
            meanings.setdefault(w["meaning"], []).append(w["wordId"])
            terms.setdefault(w["term"].lower(), []).append(w["wordId"])
        for q in lesson.get("quizzes", []):
            quiz_ids.append(q["quizId"])
            if q["wordId"] not in word_ids and q["wordId"] not in [
                w["wordId"] for lr in deck["lessons"] for w in lr["words"]
            ]:
                errs.append(f"{q['quizId']}: 参照先 wordId '{q['wordId']}' がデッキ内に存在しない")
            choice_ids = [c["choiceId"] for c in q["choices"]]
            if len(set(choice_ids)) != 4:
                errs.append(f"{q['quizId']}: choiceId が4つ異なる値でない")
            if q["answerChoiceId"] not in choice_ids:
                errs.append(f"{q['quizId']}: answerChoiceId '{q['answerChoiceId']}' が choices に無い")
            if len({c["text"] for c in q["choices"]}) != 4:
                errs.append(f"{q['quizId']}: 選択肢の text が重複 (4肢である意義が無い)")
            # 正解textがwordIdと意味的に一致するか (種別別)
            ans_text = next((c["text"] for c in q["choices"] if c["choiceId"] == q["answerChoiceId"]), None)
            if ans_text is None:
                continue  # 不正answerChoiceIdは上のエラーで検出済み
            target = next((w for lr in deck["lessons"] for w in lr["words"] if w["wordId"] == q["wordId"]), None)
            if target:
                if q["type"] == "choose-meaning" and ans_text != target["meaning"]:
                    errs.append(f"{q['quizId']}: choose-meaning の正解textが wordId の meaning と不一致")
                if q["type"] == "choose-term" and ans_text != target["term"]:
                    errs.append(f"{q['quizId']}: choose-term の正解textが wordId の term と不一致")
                if q["type"] == "fill-blank":
                    if ans_text != target["term"]:
                        errs.append(f"{q['quizId']}: fill-blank の正解textが wordId の term と不一致")
                    if "___" not in q["prompt"]:
                        errs.append(f"{q['quizId']}: fill-blank の prompt に空所 '___' が無い")
                    elif q["prompt"].replace("___", "").find(target["term"]) != -1:
                        errs.append(f"{q['quizId']}: fill-blank の答えが空所以外にも prompt に現れる (一意に決まらない)")

    for label, ids in (("lessonId", lesson_ids), ("wordId", word_ids), ("quizId", quiz_ids)):
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            errs.append(f"デッキ内で {label} 重複: {sorted(dupes)}")
    # 自動生成可能性: choose-meaning ダミーは meaning 重複があると作れない
    dup_meanings = {m: ws for m, ws in meanings.items() if len(ws) > 1}
    for m, ws in dup_meanings.items():
        errs.append(f"meaning 重複 {m!r} ({ws}) — ダミー選択肢の自動生成が曖昧になるため要修正 (explanation付き手制作成は可)")
    if len(word_ids) < 4:
        errs.append(f"デッキの語数が {len(word_ids)} (<4) — 4択のダミーを別語から生成できない")
    return errs


def validate_file(path: Path, schema: dict) -> list[str]:
    errors = []
    try:
        deck = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"JSON構文エラー: {e}"]
    v = Draft202012Validator(schema)
    for e in sorted(v.iter_errors(deck), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in e.path) or "(root)"
        errors.append(f"[schema] {loc}: {e.message}")
    if not errors:
        errors.extend(f"[consistency] {msg}" for msg in consistency_errors(deck))
    return errors


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    files = [Path(a) for a in sys.argv[1:]] or sorted(SAMPLES_DIR.glob("*.json"))
    if not files:
        print("検証対象ファイルがありません", file=sys.stderr)
        return 2
    failed = False
    for f in files:
        errors = validate_file(f, schema)
        if errors:
            failed = True
            print(f"FAIL {f}")
            for e in errors:
                print(f"  - {e}")
        else:
            deck = json.loads(f.read_text(encoding="utf-8"))
            nwords = sum(len(l["words"]) for l in deck["lessons"])
            nquiz = sum(len(l.get("quizzes", [])) for l in deck["lessons"])
            print(f"OK   {f.name}  lessons={len(deck['lessons'])} words={nwords} quizzes={nquiz}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
