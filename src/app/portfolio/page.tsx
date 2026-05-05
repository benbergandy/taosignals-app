import { redirect } from "next/navigation";

// 2026-05-05: /portfolio renamed to /wallet (page is now about user wallet
// positions, not "portfolio" as a strategy concept). This stub keeps any
// stale links / bookmarks working.
export default function PortfolioRedirect() {
  redirect("/wallet");
}
