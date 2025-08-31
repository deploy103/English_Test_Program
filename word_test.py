# word_test.py
import json
import random
import time
from pathlib import Path
import sys
import unicodedata

# ====== 유틸 ======
BASE_DIR = Path(__file__).resolve().parent  # 현재 스크립트 기준
def vwidth(ch: str) -> int:
    # 동아시아 전각/넓은 글자는 2칸 처리
    return 2 if unicodedata.east_asian_width(ch) in ("F", "W") else 1

def get_visual_width(text: str) -> int:
    return sum(vwidth(c) for c in text)

def pad(text: str, width: int) -> str:
    w = get_visual_width(text)
    return text + " " * max(0, width - w)

def ask_choice(prompt: str, options: dict):
    # options: { "1": ("라벨", value), ... }
    print(prompt)
    for k, (label, _) in options.items():
        print(f"{k}. {label}")
    while True:
        sel = input("> ").strip()
        if sel in options:
            return options[sel][1]
        print("유효한 번호를 입력하세요.")

def countdown(sec: int):
    print(f"\n{sec}초 후 테스트를 시작합니다.")
    for s in range(sec, 0, -1):
        print(s)
        time.sleep(1)
    print("-----Start-----\n")

# ====== 메뉴 ======
print("Choice Test")
file_options = {
    "1": ("Sesson1_Lesson3 Word", BASE_DIR / "Word_list" / "HS_1_Sesson" / "Lesson3_words.json"),
    "2": ("Sesson1_Lesson4 Word", BASE_DIR / "Word_list" / "HS_1_Sesson" / "Lesson4_words.json"),
    "3": ("Sesson2_Lesson1 Word", BASE_DIR / "Word_list" / "HS_2_Sesson" / "Lesson1_words.json"),
}
json_path = ask_choice("테스트할 단어장을 고르세요:", file_options)

count_options = {
    "1": ("30개", 30),
    "2": ("40개", 40),
    "3": ("50개", 50),
}
num_questions = ask_choice("\n몇 개의 단어를 띄울까요?", count_options)

mode_options = {
    "1": ("Only Korean", "ko"),
    "2": ("Only English", "en"),
    "3": ("Random", "rand"),
}
show_mode = ask_choice("\n어떤 언어로 문제를 낼까요?", mode_options)

# 보여주는 한 문제당 정지 시간(초)
display_time_options = {
    "1": ("3초", 3),
    "2": ("5초", 5),
    "3": ("6초", 6),
}
display_time = ask_choice("\n한 문제 표시 시간을 고르세요:", display_time_options)

# 카운트다운
countdown(3)

# ====== 로드 ======
if not json_path.exists():
    print(f"파일을 찾을 수 없습니다: {json_path}")
    sys.exit(1)

try:
    with open(json_path, "r", encoding="utf-8") as f:
        words = json.load(f)
except json.JSONDecodeError as e:
    print(f"JSON 파싱 실패: {e}")
    sys.exit(1)

# 키 소문자 정규화
norm_words = [{k.lower(): v for k, v in w.items()} for w in words]
# 방어: english/ korean 키만 사용
norm_words = [w for w in norm_words if "english" in w and "korean" in w]

if not norm_words:
    print("단어 데이터가 비어 있습니다.")
    sys.exit(1)

random.shuffle(norm_words)
selected = norm_words[: min(num_questions, len(norm_words))]

# ====== 출제 ======
history = []
i = 0
for w in selected:
    en = str(w["english"])
    ko = str(w["korean"])

    if show_mode == "ko":
        shown, answer = ko, en
    elif show_mode == "en":
        shown, answer = en, ko
    else:  # rand
        shown = random.choice([en, ko])
        answer = ko if shown == en else en

    i += 1
    print(f"{i:2d}: {shown}")
    print("-" * 30)
    history.append((i, shown, answer))
    time.sleep(display_time)

print("\n모든 단어가 끝났습니다.\n")

# ====== 정답표 ======
left_w = 30
right_w = 30
print(f"{'문제 번호':<6} {'문제':<30} {'정답':<30}")
print("=" * 70)
for idx, problem, solution in history:
    print(f"{idx:<6} {pad(problem, left_w)} {pad(solution, right_w)}")
print("=" * 70)
