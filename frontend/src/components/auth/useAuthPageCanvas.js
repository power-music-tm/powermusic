import { useEffect } from 'react';

export const AUTH_PAGE_CANVAS = '#1a1a2e';

/** Pin html/body to the auth background so overscroll never reveals white (Instagram-style). */
export function useAuthPageCanvas() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prev = {
      htmlBg: html.style.backgroundColor,
      bodyBg: body.style.backgroundColor,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };

    html.style.backgroundColor = AUTH_PAGE_CANVAS;
    body.style.backgroundColor = AUTH_PAGE_CANVAS;
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    let themeMeta = document.querySelector('meta[name="theme-color"]');
    const createdThemeMeta = !themeMeta;
    const prevTheme = themeMeta?.getAttribute('content') ?? '';

    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute('content', AUTH_PAGE_CANVAS);

    return () => {
      html.style.backgroundColor = prev.htmlBg;
      body.style.backgroundColor = prev.bodyBg;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overscrollBehavior = prev.bodyOverscroll;

      if (createdThemeMeta) {
        themeMeta.remove();
      } else {
        themeMeta.setAttribute('content', prevTheme);
      }
    };
  }, []);
}
