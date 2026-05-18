import os

# VS Code 최적화 기획서 내용 정의

vscode_md_content = """# 🚀 [개발 기획서] 지능형 메모 기반 자동 하이라이터 (Memo-Driven Highlighter)

```
> **프로젝트 목표:** 3일(총 18시간) 내에 구현 가능한 MVP 규격의 크롬 익스텐션 개발
> **개발 환경:** VS Code (Visual Studio Code)
```

---

## 1. 서비스 정의 (Service Definition)

```
* **서비스 정의:** 사용자가 웹 서핑 중 기록한 메모와 특정 단어를 유기적으로 연결하여 '나만의 지식 지도'를 구축하는 도구입니다.[cite: 1]
* **주요 가치:** 한 번 정리한 지식이 다른 웹사이트에서도 자동으로 강조되어 학습의 연속성을 제공하고 망각을 방지합니다.[cite: 1]
* **타겟 사용자:** 학생 및 교육자 (강조하고 싶은 내용 정리, 몰랐던 내용 메모 및 지식화).[cite: 1]
```

---

## 2. 핵심 기능 정의 (Core Features)

### 2.1 데이터 저장 및 실시간 연동

```
* **로컬 스토리지:** `chrome.storage.local` API를 사용하여 메모, 하이라이트 단어 리스트, 미디어 링크를 브라우저에 보존합니다.[cite: 1]
* **실시간 반영:** 메모 저장 시 현재 열려 있는 모든 탭의 하이라이트가 즉시 업데이트되는 이벤트 기반 로직을 구현합니다.[cite: 1]
```

### 2.2 사용자 인터페이스 (UI/UX)

```
* **플로팅 메모장:** 화면 우측에 위치하며 단축키나 버튼으로 토글(Show/Hide) 가능한 오버레이 UI입니다.[cite: 1]
* **듀얼 레이아웃:**
    * **팝업(Popup):** 상단 바 아이콘 클릭 시 나타나는 빠른 요약 창.[cite: 1]
    * **사이드패널(Sidepanel):** 크롬 사이드바에 고정되어 상세 편집 및 관리가 가능한 창.[cite: 1]
* **컨텍스트 메뉴:** 드래그한 텍스트 위에서 우클릭 시 즉시 하이라이트 및 메모를 등록합니다.[cite: 1]
```

### 2.3 지능형 하이라이트 및 툴팁

```
* **자동 하이라이트:** 저장된 키워드를 웹페이지에서 찾아 `<span>` 태그를 주입하여 시각적으로 강조합니다.[cite: 1]
* **지능형 툴팁:** 하이라이트된 단어에 마우스를 올리면(Hover) 작성했던 메모 내용이 말풍선으로 노출됩니다.[cite: 1]
```

## 3. 기술 스택 (Tech Stack)

```
* **Platform:** Chrome Extension Manifest V3 (최신 규격)[cite: 1]
* **Languages:** HTML5, CSS3, Vanilla JavaScript (ES6+)[cite: 1]
* **Core APIs:** `chrome.storage`, `chrome.sidePanel`, `chrome.contextMenus`, `DOM Manipulation`, `Regex`[cite: 1]
```

---

## 4. 18시간 집중 개발 로드맵 (3 Days)

```
| 일정 | 단계 | 주요 작업 내용 (VS Code 환경)[cite: 1] |
| :--- | :--- | :--- |
| **1일차 (6h)** | **UI & 기초 설정** | - `manifest.json` 설정 (Storage, SidePanel 권한 부여)<br>- 플로팅 메모장 UI 레이아웃 및 사이드패널 기본 구조 구현 |
| **2일차 (6h)** | **데이터 엔진 구축** | - `chrome.storage.local` 기반 메모 CRUD 로직 완성<br>- 우클릭 메뉴 연동 및 드래그 텍스트 추출 기능 구현 |
| **3일차 (6h)** | **하이라이트 구현** | - 웹페이지 내 단어 검색 및 실시간 하이라이트(DOM Injection) 완성<br>- 마우스 오버 툴팁 기능 추가 및 최종 CSS 폴리싱 |
```

---

## 5. 프로젝트 기대 효과

```
1. **기술적 성장:** 데이터가 저장소를 거쳐 웹페이지에 동적으로 반영되는 풀스택 클라이언트 흐름 이해.[cite: 1]
2. **실용적 가치:** 다른 사이트에서도 내 지식이 자동으로 환기되는 강력한 학습 경험 제공.[cite: 1]
3. **완성도:** 자바스크립트 기초만으로 핵심 로직의 80%를 완성할 수 있어 3일 내 결과물 도출 용이.[cite: 1]
"""
```

# 파일 저장

```
file_name = "Extension_Project_Plan.md"
with open(file_name, "w", encoding="utf-8") as file:
    file.write(vscode_md_content)

print(f"VS Code용 기획서 파일이 생성되었습니다: {file_name}")
```
