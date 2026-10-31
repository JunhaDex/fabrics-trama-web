@../../CLAUDE.md
@../../docs/ssot/org-principles.md
@../../docs/ssot/repo-architecture.md
@AGENTS.md

# trama-web (fabrics-trama-web)

자유 캔버스에서 디자인한 화면을 규칙에 따라 결정적으로 HTML/CSS로 변환하고, 사람과
AI가 같은 문서를 실시간으로 함께 편집하는 웹 기반 UI 디자인 도구 trama의 편집기다.
조직 공통 원칙은 위 `@import`로 상속하며, 이 파일은 프로젝트 고유 사항만 기술한다.

## 참조 문서
- 요구사항 명세: `../../docs/references/fabrics-tala-requirements.md` (설계 원칙과 확정 결정의 정본)
- 문서 모델과 연산 계약: `../../docs/architecture/trama-document-model.md` (초안)
- 결정 사항과 진행 상황: `../../docs/trama-web-todo.md`

## 스택
| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js (App Router), React. 단일 패키지 |
| 패키지 관리 | pnpm |
| 스타일 | Tailwind v4 |
| 린트 | ESLint (`eslint-config-next`) |
| 버전 | `create-next-app` 템플릿 값을 따른다 |
| 대상 브라우저 | 편집기는 최신 Chrome(Chromium)만 지원한다 |

## 저장소 범위
- 이 저장소는 trama의 web(편집기와 HTML 변환기)만 담는다. server와 infra는 언어가
  달라 별도 저장소로 만든다(2단계)
- 서버와 공유해야 하는 계약(문서 모델, 연산 스키마, 오류 코드)은 이 저장소가 아니라
  메타 저장소 `../../docs/architecture/`가 정본이다. 계약을 바꾸는 코드 변경은 그 문서를 함께 갱신한다

## todo 관리
작업이 진행되면 루트 `../../docs/trama-web-todo.md`를 실시간으로 갱신한다.
구조와 릴리스 시 처리는 `../../docs/TODO.md`의 "프로젝트 todo 파일" 절을 따른다.
시행착오는 기록하지 않고 최종 결정만 남긴다.
