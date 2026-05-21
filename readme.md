# 🌝Memo-note-Hoghlighte 크롬 확장프로그램 만들기

- 메모노트하이라이터는 학생들의 학습을 돕는 크롬 확장프로그램입니다.

---

## 🌜개발 기간

### 5월 18일 ~ 5월 21일

---

## ⭐프로잭트 개요

- 프로잭트명: Memo-Driven Highlighter
- 형태: Chrome Extension, Manifest V3
- 주요 기술: HTML, CSS, JavaScript, Chrome Extension API
- 저장 방식: `Chrome storage local`

---

## ⭐주요 기능

- 키워드, 메모, 색상 저장 🎨
- 저장된 키워드를 웹페이지 본문에서 자동 하이라이트 ✨
- 하이라이트 마우스 호버시 메모 툴팁 표시 📖
- 우클릭 컨텍스트 메뉴로 선택한 텍스트 가져오기 ✂
- 사이드패널에서 하이라이트 목록 관리 📚
- 저장된 하이라이트의 최초위치 url저장 💾
- 웹페이지 우측 하단 위젯에서 빠른 저장 💼
- 현재 사이트별 하이라이트 켜기/끄기 🔊🔈
- 테마 선택 기능

---

## ⭐사용 흐름

1. 웹페이지에서 강조하고 싶은 단어나 문장을 저장.
2. 저장된 데이터는 브라우저 로컬 저장소에 보관.
3. 사용자가 다른 웹페이지를 열면 저장된 키워드를 찾는다.
4. 일치하는 텍스트가 있을시 자동 하이라이트
5. 하이라이트 위에 마우스를 올리면 저장한 메모를 확인

---

## ⭐파일구조

- `manifest.json` ==> 확장 프로그램 설정, 권한, content script, side panel 설정
- `Memo-Driven_Highlighter.js` ==> background service worker, 컨텍스트 메뉴, 메시지 처리, storage 관리

- |--- - `content.js` ==> 웹페이지 하이라이트 적용, 위젯, 메모 툴팁 처리
- |- `floatong-widget.html` ==> 웹페이지 안에 표시되는 빠른 저장 위젯 마크업
- |--- - `floatong-widget.css` ==> 위젯 스타일

- |--- - `sidepanel.html` ==> 사이드패널 화면 구조
- |- `ui.js` ==> 사이드패널 UI동작 하이라이트 CRUD 처리
- |--- - `ui.css` ==> 사이드패널 UI 스타일

- `icon` ==> 아이콘

---
