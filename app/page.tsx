import { redirect } from "next/navigation";

export default function Home() {
  // The beforeFiles rewrite serves the immersive static landing at `/` while
  // preserving the clean URL. This remains as a safe framework-level fallback.
  redirect("/landing.html");
}
