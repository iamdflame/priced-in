// The embed's script tag: <script src=".../embed.js" data-fact="18" async></script> puts the framed
// fact right where the tag sits. data-theme="light" switches theme.
import { SITE_URL } from "@/lib/nav";

const SCRIPT = `(function(){var s=document.currentScript;if(!s)return;var id=s.getAttribute("data-fact");if(!/^\\d+$/.test(id||""))return;var f=document.createElement("iframe");var t=s.getAttribute("data-theme")==="light"?"?theme=light":"";f.src=${JSON.stringify(`${SITE_URL}/embed/`)}+id+t;f.title="Is it true? Priced In";f.loading="lazy";f.width="420";f.height="236";f.style.border="0";f.style.maxWidth="100%";s.parentNode.insertBefore(f,s)})();`;

export function GET() {
  return new Response(SCRIPT, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
