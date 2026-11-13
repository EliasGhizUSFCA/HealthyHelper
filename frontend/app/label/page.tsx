import type { Metadata } from "next";
import { LabelApp } from "@/components/Dataset/LabelApp";

export const metadata: Metadata = { title: "Label data · AI Health Mirror" };

export default function LabelPage() {
  return <LabelApp />;
}
