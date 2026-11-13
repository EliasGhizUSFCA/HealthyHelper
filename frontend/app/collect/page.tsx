import type { Metadata } from "next";
import { CollectApp } from "@/components/Dataset/CollectApp";

export const metadata: Metadata = { title: "Collect data · AI Health Mirror" };

export default function CollectPage() {
  return <CollectApp />;
}
