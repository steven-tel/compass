import { AtmosphereLights } from "@/components/AtmosphereLights";
import { SessionComputing } from "@/components/SessionComputing";

export default function SessionLoading() {
  return (
    <main className="session-view is-computing">
      <AtmosphereLights />
      <SessionComputing />
    </main>
  );
}
