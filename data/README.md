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

## 🚀 선별 및 Firestore 시드(Seed) 방법

### 방법 1: 원하는 곡만 선별하여 시드하기 (권장)
1. `data/cleaned/hymns/` 또는 `data/cleaned/worship/`에서 등록하고 싶은 곡의 `.txt` 파일들을 **`data/cleaned/selected/`** 폴더로 복사합니다.
2. 로컬 Firestore 에뮬레이터(`pnpm emulators`)에 주입 테스트:
   ```bash
   node scripts/seedSelected.mjs --target=local
   ```
3. 확인 후 프로덕션 Firestore에 적재 (운영 데이터를 쓰므로 실행 전에 확인받는다):
   ```bash
   GOOGLE_CLOUD_PROJECT=<프로젝트 id> node scripts/seedSelected.mjs --target=remote
   ```

### 방법 2: 폴더 단위 일괄 업로드
```bash
# 새찬송가 639곡 전체 주입
node scripts/seedSelected.mjs --dir=data/cleaned/hymns --target=local

# 핵심 워십 1,202곡 전체 주입
node scripts/seedSelected.mjs --dir=data/cleaned/worship --target=local
```

### 이미 넣은 곡 고치기
`cleaned/*.json`에서 운영에 이미 넣은 곡의 제목이나 가사를 고치면 옛 값과 고친 값을 `data/officialLibraryFixes.json`에도 적습니다. 시드는 이 목록으로 옛 제목의 곡을 고친 곡과 같은 곡으로 보고 다시 넣지 않으며, 운영에 들어간 곡은 `node scripts/fixLibraryText.mjs`로 제자리에서 고칩니다.
