// The kit's line icons (24-unit grid, 1.75 stroke), plus a few the product needed.
const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  flag: '<path d="M6 21V4h12l-2.6 4L18 12H6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M16 15h2"/>',
  share: '<path d="M12 15V4M8 7.5L12 4l4 3.5M5 13v5a2 2 0 002 2h10a2 2 0 002-2v-5"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>',
  down: '<path d="M12 4v11M8 11.5l4 4 4-4M5 20h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  ext: '<path d="M8 16L18 6M10 6h8v8"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  book: '<path d="M5 19.5V5a2 2 0 012-2h12v14H7a2 2 0 00-2 2.5zM5 19.5A2 2 0 007 21h12v-4"/>',
  scale: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0z"/>',
  gavel: '<path d="M14 5l5 5M11.5 7.5l5 5M12.8 6.2l4 4-6.6 6.6-4-4zM8.2 14.8L3.5 19.5M13 21h8"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.4-2.5-1.2M12 6.5v1.5M12 16v1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4M12 17h.01"/>',
  wifi: '<path d="M2 8.5a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0M12 19h.01M3 3l18 18"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4.5" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.5-3.5-6-3.5-5 0M12 8c1.5-3.5 6-3.5 5 0"/>',
  arrow: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  users: '<circle cx="9" cy="9" r="3.5"/><path d="M2.5 19a6.5 6.5 0 0113 0M16 5.5a3.5 3.5 0 010 7M21.5 19a6.5 6.5 0 00-4-6"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "", label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
  );
}

export function Arrow() {
  return <svg className="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" /></svg>;
}
