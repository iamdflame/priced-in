// Film mode (?film=1), for recording the demo film: no replay bar or coach mark, countdowns and the live
// strip hold still, and no free-bet key is ever asked for. It changes no data. The flag is kept for the
// tab in sessionStorage, so it carries across internal links; ?film=0 ends it. app/layout.tsx applies it
// before paint, as data-film on <html> (with the "still" class that stops motion).
export const FILM_KEY = "pi-film";

/** True while this tab is in film mode. */
export const filming = () => typeof document !== "undefined" && document.documentElement.dataset.film === "1";

/** The inline, before-paint part, run by app/layout.tsx's head script. */
export const FILM_SCRIPT = `var fq=new URLSearchParams(location.search).get('film');if(fq==='1')sessionStorage.setItem('${FILM_KEY}','1');if(fq==='0')sessionStorage.removeItem('${FILM_KEY}');if(sessionStorage.getItem('${FILM_KEY}')){var de=document.documentElement;de.dataset.film='1';de.dataset.coach='off';de.classList.add('still')}`;
