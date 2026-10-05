import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Vaulte — B2B Payment Infrastructure",
};

export default function CorridorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
