import { PageSkeleton } from "@/components/pages/PageSkeleton";
import "../styles/pages.css";

export default function Loading() {
  return <PageSkeleton kpis={5} />;
}
