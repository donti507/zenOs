import type { AdventureSpec } from "../spec";
import {
  conceptMastery,
  practiceMissionIds,
  allMissions,
  type AdventureRun,
} from "./adaptation";
import { questStatus } from "./quest";
import { tr, useUiLanguage } from "../../i18n";
import { btn, card } from "../../components/ui/kit";
export default function ConceptMasteryPanel({
  spec,
  run,
  onPractice,
}: {
  spec: AdventureSpec;
  run: AdventureRun;
  onPractice: (id: string) => void;
}) {
  useUiLanguage();
  const mastery = conceptMastery(spec, run.learning),
    practice = practiceMissionIds(spec, run.learning),
    effective = { ...spec, missions: allMissions(spec) };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        className={card + " p-4 space-y-3 min-w-0 [overflow-wrap:anywhere]"}
        aria-label={tr("Concept mastery")}
      >
        <h2 className="font-semibold">{tr("Learning · Concept mastery")}</h2>
        <p className="text-sm text-on-surface-variant">
          {tr(
            "A practice estimate from answer checks, first tries, retries and hints. This is not a test grade.",
          )}
        </p>
        {mastery.map((c) => (
          <article
            key={c.conceptId}
            className="rounded-lg bg-surface-container-low p-3 space-y-2"
          >
            <h3 className="font-medium">{c.name}</h3>
            <p className="text-sm">
              {c.score === null
                ? tr("Not enough evidence")
                : tr("Evidence estimate: {{0}}/100", c.score)}
            </p>
            <p className="text-xs text-on-surface-variant">
              {tr(
                "First-try correct: {{0}} · Retries: {{1}} · Hints used: {{2}}",
                c.correctFirstTry,
                c.retries,
                c.hintsUsed,
              )}
            </p>
            {c.needsPractice && (
              <p className="text-sm">{tr("Extra practice recommended")}</p>
            )}
          </article>
        ))}
        {practice.map((id) => {
          const mission = effective.missions.find((m) => m.id === id)!,
            status = questStatus(effective, run.engagement.progress, id);
          return (
            <button
              key={id}
              className={btn.secondary + " w-full min-h-11 text-left"}
              disabled={status === "completed" || status === "locked"}
              onClick={() => onPractice(id)}
            >
              {tr("Extra practice: {{0}}", mission.title)}
              {status === "completed" ? " ✓" : ""}
            </button>
          );
        })}
        {mastery.some((c) => c.needsPractice) && !practice.length && (
          <p className="text-sm text-on-surface-variant">
            {tr(
              "No stored practice variant is available. Ask the NPC for another explanation.",
            )}
          </p>
        )}
      </section>
      <section
        className={card + " p-4 space-y-3"}
        aria-label={tr("Engagement metrics")}
      >
        <h2 className="font-semibold">{tr("Engagement · Activity")}</h2>
        <p>
          {tr(
            "Completed missions: {{0}}",
            run.engagement.progress.completed.length,
          )}
        </p>
        <p>
          {tr(
            "Active time estimate: {{0}} min",
            Math.floor(run.engagement.activeSeconds / 60),
          )}
        </p>
        <p className="text-sm text-on-surface-variant">
          {tr(
            "Time, completion and XP describe activity. They do not measure mastery.",
          )}
        </p>
      </section>
    </div>
  );
}
