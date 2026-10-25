/** 예전 자체 테마 저장 키를 그대로 써서 사용자가 고른 테마를 잃지 않는다 */
export const THEME_STORAGE_KEY = "worship-theme";

/**
 * 첫 페인트 전에 `<html>`에 테마 클래스를 붙이는 인라인 스크립트. 서버가 그린 로딩 화면이
 * 다크 모드 사용자에게 흰색으로 번쩍이지 않게 한다. 고르는 규칙은 `ThemeProvider`와 같다.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.add(t)}catch(e){}`;
