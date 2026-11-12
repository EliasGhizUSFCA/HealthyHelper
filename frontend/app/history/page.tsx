import type { Metadata } from "next";
import { HistoryApp } from "@/components/History/HistoryApp";

export const metadata: Metadata = { title: "Comparisons · AI Health Mirror" };

export default function HistoryPage() {
  return <HistoryApp />;
}
