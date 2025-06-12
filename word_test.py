import random
import time
import json

print("Choice Test")
print("1. Lesson3 Word")
print("2. Lesson4 Word")


while True:
    try:
        choise = int(input()) 
        if choise == 1 or choise == 2:
            break
        else:
            print("1 또는 2를 입력해주세요.")
    except ValueError:
        print("숫자를 입력해주세요.")


if choise == 1:
    file_path = r"C:\Code\Word_Test\Lesson3_words.json"       # Insert to Your Lesson3_words.json file Path 
elif choise == 2:
    file_path = r"C:\Code\Word_Test\Lesson4_words.json"       # Insert to your Lesson4_word.json file Path


try:
    with open(file_path, "r", encoding="utf-8") as file:
        words = json.load(file)
except FileNotFoundError:
    print(f"파일을 찾을 수 없습니다: {file_path}")
    exit()


random.shuffle(words)
i = 0


wordMemory = []


display_time = 6    # word stop time setting

print("-----Start-----\n")

for word in words[:40]:    # word count adjustment
    word = {k.lower(): v for k, v in word.items()}
    shown = random.choice([word['english'], word['korean']])
    
    answer = word['korean'] if shown == word['english'] else word['english']
    
    i += 1
    print(f"{i:2d}: {shown}")
    print("-" * 30)
    
    wordMemory.append((i, shown, answer))
    
    time.sleep(display_time)

print("\n모든 단어가 끝났습니다.\n")

def get_visual_width(text):
    # 한글은 2칸, 나머지는 1칸으로 계산
    return sum(2 if ord(ch) > 128 else 1 for ch in text)

def pad(text, width):
    visual_width = get_visual_width(text)
    return text + ' ' * (width - visual_width)

print(f"{'문제 번호':<6} {'문제':<30} {'정답':<30}")
print("=" * 70)

for idx, problem, solution in wordMemory:
    print(f"{idx:<6} {pad(problem, 30)} {pad(solution, 30)}")

print("=" * 70)


