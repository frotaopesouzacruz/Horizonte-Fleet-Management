import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemView } from "./design-system-view";

/**
 * Internal design-system reference. Available in development, and in a built
 * app only when NEXT_PUBLIC_ENABLE_DEV_PAGES=1 (used by the UI test run).
 * It is never reachable in a normal production deployment.
 */
export const metadata: Metadata = {
  title: "Design System",
  robots: { index: false, follow: false },
};

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default function DesignSystemPage() {
  if (!enabled) notFound();
  return <DesignSystemView />;
}
