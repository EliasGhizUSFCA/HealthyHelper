import type { Metadata } from "next";
import { MirrorApp } from "@/components/Mirror/MirrorApp";

export const metadata: Metadata = { title: "Health Mirror · AI Health Mirror" };

export default function MirrorPage() {
  return <MirrorApp />;
}
