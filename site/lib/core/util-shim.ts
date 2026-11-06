// near-api-js pulls in is-my-json-valid (ABI validation, unused by the site), whose code
// generator calls util.format. This is enough of Node's util for that path in a browser.
export function format(f: unknown, ...args: unknown[]): string {
  if (typeof f !== "string") return [f, ...args].map(String).join(" ");
  let i = 0;
  const out = f.replace(/%[sdjifoO%]/g, (m) => {
    if (m === "%%") return "%";
    const a = args[i++];
    if (m === "%j") return JSON.stringify(a);
    if (m === "%d" || m === "%i") return String(Math.trunc(Number(a)));
    if (m === "%f") return String(Number(a));
    return String(a);
  });
  return [out, ...args.slice(i).map(String)].join(" ");
}
export default { format };
