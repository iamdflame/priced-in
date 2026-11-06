// Topic art per theme: the light set (public/art/light, objects on white) and the dark set (public/art,
// objects on graphite). Both are rendered; base.css shows the one for the theme set before paint, so there
// is no flash. The hidden one is always lazy, so it never loads: only the light file may be eager.
import Image from "next/image";

export function Art({ name, width, height, sizes, eager = false, priority = false }: {
  name: string; width: number; height: number; sizes?: string; eager?: boolean; priority?: boolean;
}) {
  return (
    <>
      <Image className="th-l" src={`/art/light/${name}.webp`} alt="" width={width} height={height} sizes={sizes} priority={priority} loading={priority ? undefined : eager ? "eager" : "lazy"} />
      <Image className="th-d" src={`/art/${name}.webp`} alt="" width={width} height={height} sizes={sizes} loading="lazy" />
    </>
  );
}
