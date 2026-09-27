# 찬양 가사 데이터 수집 아카이브 및 선별 가이드

본 디렉터리는 한국 찬양(새찬송가 및 핵심 워십/CCM)을 수집하여 텍스트 파일로 추출하고, 예배용 순수 가사로 전처리, 노이즈 필터링 및 사용자 검수를 거쳐 최종 확정(Fix)한 저장소입니다.

---

## 📁 디렉터리 및 최종 JSON 구조

```
data/
  ├── cleaned/                 # [최종 확정본] 사용자가 직접 검수하고 다듬은 순수 가사 & JSON
  │     ├── hymns/             # 새찬송가 639곡 개별 TXT (1장~639장)
  │     ├── worship/           # 핵심 워십 1,202곡 개별 TXT (대표 워십팀/사역자)
  │     ├── selected/          # 사용자가 선별하여 복사해 넣는 폴더 (시드 대상)
  │     │
  │     ├── hymns.json         # [Fix] 새찬송가 639곡 최종 JSON (title, artist, lyrics)
  │     ├── worship.json       # [Fix] 핵심 워십 1,202곡 최종 JSON (title, artist, lyrics)
  │     └── songs.json         # [Fix] 찬송가 + 워십 전체 통합 1,841곡 최종 JSON
  │
  └── extracted/               # [원본 백업 아카이브] 헤더 및 메타데이터 포함 원본 데이터
        ├── hymns/             # 새찬송가 원본 645개 TXT
        └── worship/           # 워십 원본 TXT
```

---

## 📋 JSON 스키마 규격

모든 JSON 파일은 아래와 같이 `title`, `artist`, `lyrics` 필드로 일관되게 구조화되어 있습니다.

```json
{
  "title": "주 은혜임을",
  "artist": "마커스워십 (MARKERS WORSHIP)",
  "lyrics": "주 나의 모습 보네\n상한 나의 맘 보시네\n주 나의 눈물 아네\n홀로 울던 날 아시네\n..."
}
```

---

## 🚀 선별 및 D1 데이터베이스 시드(Seed) 방법

### 방법 1: 원하는 곡만 선별하여 시드하기 (권장)
1. `data/cleaned/hymns/` 또는 `data/cleaned/worship/`에서 등록하고 싶은 곡의 `.txt` 파일들을 **`data/cleaned/selected/`** 폴더로 복사합니다.
2. 로컬 D1에 주입 테스트:
   ```bash
   node scripts/seedSelected.mjs --target=local
   ```
3. 확인 후 프로덕션 D1에 적재:
   ```bash
   node scripts/seedSelected.mjs --target=remote
   ```

### 방법 2: 폴더 단위 일괄 업로드
```bash
# 새찬송가 639곡 전체 주입
node scripts/seedSelected.mjs --dir=data/cleaned/hymns --target=local

# 핵심 워십 1,202곡 전체 주입
node scripts/seedSelected.mjs --dir=data/cleaned/worship --target=local
```
