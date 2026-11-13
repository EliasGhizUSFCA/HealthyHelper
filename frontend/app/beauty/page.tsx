import type { Metadata } from "next";
import { BeautyApp } from "@/components/Beauty/BeautyApp";

export const metadata: Metadata = { title: "Beauty recommendations · AI Health Mirror" };

export default function BeautyPage() {
  return <BeautyApp />;
}
