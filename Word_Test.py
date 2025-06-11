import random
import time

# 단어 목록 (영어, 한국어)
words = [
    {"english": "react", "korean": "반응하다"},
    {"english": "confused", "korean": "당황한"},
    {"english": "term", "korean": "용어"},
    {"english": "unique", "korean": "독특한"},
    {"english": "usage", "korean": "사용-용법"},
    {"english": "misunderstanding", "korean": "오해"},
    {"english": "highlight", "korean": "강조하다"},
    {"english": "diversity", "korean": "다양성"},
    {"english": "variety", "korean": "종류"},
    {"english": "due to", "korean": "~때문에"},
    {"english": "adoption", "korean": "차용"},
    {"english": "demand", "korean": "수요"},
    {"english": "critical", "korean": "중대한"},
    {"english": "be exposed to", "korean": "~노출되다"},
    {"english": "contribute", "korean": "기부하다"},
    {"english": "influence", "korean": "영향"},
    {"english": "emerge", "korean": "나오다-드러내다"},
    {"english": "standard", "korean": "수준-기준"},
    {"english": "evolve", "korean": "진화하다"},
    {"english": "local", "korean": "지역적인"},
    {"english": "modification", "korean": "변경-수정"},
    {"english": "take place", "korean": "[상황이]일어나다"},
    {"english": "coin", "korean": "동전"},
    {"english": "postpone", "korean": "연기하다-미루다"},
    {"english": "encouragement", "korean": "격려"},
    {"english": "translation", "korean": "번역-해석"},
    {"english": "inject", "korean": "주입하다-주사하다"},
    {"english": "trap", "korean": "가두다"},
    {"english": "avoid", "korean": "막다"},
    {"english": "incorporate", "korean": "포함하다"},
    {"english": "spread", "korean": "퍼지다-펼치다"},
    {"english": "opportunity", "korean": "기회"},
    {"english": "embrace", "korean": "받아들이다"},
    {"english": "prejudice", "korean": "편견-편견을갖게되다"},
    {"english": "stereotype", "korean": "고정관념"},
    {"english": "momentarily", "Korean": "잠깐"},
    {"english": "cause confusion", "korean": "혼란을 초래하다"},
    {"english": "World Englishes", "korean": "세계 영어(들)"},
    {"english": "lingua franca", "korean": "공통어"},
    {"english": "extensive usage", "korean": "광범위한 사용"},
    {"english": "communicate", "korean": "소통하다"},
    {"english": "uderstand each other", "korean": "서로 이해하다"},
    {"english": "a means of communication", "korean": "의사소통 수단"},
    {"english": "critical field", "korean": "중요한 분야"},
    {"english": "on a daily basis", "korean": "매일"},
    {"english": "widespread use", "korean": "광범위한 사용"},
    {"english": "global influence", "korean": "전 세계적인 영향력"},
    {"english": "standard model", "korean": "표준 모델"},
    {"english": "regional variation", "korean": "지역적 변이"},
    {"english": "refer to A as B", "korean": "A를 B라고 지칭한다"},
    {"english": "undergo changes", "korean": "변화를 겪다"},
    {"english": "utilize", "korean": "활용하다"},
    {"english": "reflect", "korean": "반영하다"},
    {"english": "cultural context", "korean": "문화적 맥락"},
    {"english": "liguistic change", "korean": "언어 변화"},
    {"english": "grammar", "korean": "문법"},
    {"english": "pronunciation", "korean": "발음"},
    {"english": "vocabulary", "korean": "어휘"},
    {"english": "expression", "korean": "표현"},
    {"english": "be modified", "korean": "변화되다"},
    {"english": "create", "korean": "만들다"},
    {"english": "coin a term", "korean": "용어를 만들어내다"},
    {"english": "trap heat and smell", "korean": "열과 냄새를 가두다"},
    {"english": "evolution", "korean": "진화"},
    {"english": "match up with", "korean": "~와 부합하다"},
    {"english": "gain expousure", "korean": "노출되다"},
    {"english": "contribute to", "korean": "~에 기여하다"},
    {"english": "expansion", "korean": "확장"},
    {"english": "diversification", "korean": "다양화"},
    {"english": "be borrowed from", "korean": "~에서 차용되다"},
    {"english": "estavlished term", "korean": "확립된 용어"},
    {"english": "gain currency", "korean": "통용되다"},
    {"english": "as a result of", "korean": "~의 결과로"},
    {"english": "result in", "korean": "~을 낳다"},
    {"english": "be included in", "korean": "~에 포함되다"},
    {"english": "accrodingly", "korean": "그에 따라"},
    {"english": "incorporate cultures", "korean": "문화를 수용하다"},
    {"english": "broaden understanding", "korean": "이해를 확대하다"},
    {"english": "respect", "korean": "존중"},
    {"english": "be open to", "korean": "~에 대해 열린 자세를 갖다"},
    {"english": "embrace diversity", "korean": "다양성을 수용하다"},
    {"english": "inclusive community", "korean": "포용적인 공동체"},
    {"english": "belong to", "korean": "~에 속하다"},
]

# 랜덤으로 단어 섞기
random.shuffle(words)

# 출력 개수 카운터
i = 0

# 문제와 답을 별도로 저장할 리스트
wordMemory = []

# 시간 설정 (초 단위)
display_time = 0.001

print("-----Start-----\n")

# 30개의 단어를 하나씩 랜덤으로 출력
for word in words[:30]:
    # 영어 또는 한국어 중 하나를 랜덤 선택
    shown = random.choice([word['english'], word['korean']])
    
    # 반대어 결정
    answer = word['korean'] if shown == word['english'] else word['english']
    
    # 출력
    i += 1
    print(f"{i:2d}: {shown}")
    print("-" * 30)
    
    # 문제와 답을 튜플 형태로 저장 (단어 순서대로)
    wordMemory.append((i, shown, answer))  # 번호와 함께 저장
    
    # 시간 동안 대기
    time.sleep(display_time)

print("\n모든 단어가 끝났습니다.\n")

# 좌·우 두 열로 정리해서 출력
print(f"{'문제 번호':<12} {'문제':<30} {'답'}")
print("=" * 60)

# wordMemory에 저장된 순서대로 출력 (문제 순서대로)
for idx, shown, answer in wordMemory:
    print(f"{idx:<12} {shown:<30} {answer.ljust(30)}")