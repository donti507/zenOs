import { useState } from "react";
import { Link } from "react-router-dom";
import { useZenos } from "../context/ZenosContext";
import { tr, useUiLanguage } from "../i18n";
import { PageHeader, Icon, btn, card } from "../components/ui/kit";
function stageLabel(stage: string) {
  switch (stage) {
    case "extracting":
      return tr("Reading source");
    case "analyzing":
      return tr("Finding learning objectives");
    case "generating":
      return tr("Building your world");
    case "validating":
      return tr("Checking the game");
    case "grounding":
      return tr("Checking source support");
    case "saving":
      return tr("Saving adventure");
    default:
      return "";
  }
}
export default function Adventures() {
  useUiLanguage();
  const z = useZenos();
  const { adventures } = z;
  const [lecture, setLecture] = useState(""),
    [file, setFile] = useState<File | null>(null);
  return (
    <section>
      <PageHeader
        title={tr("Adventures")}
        subtitle={tr("Step into a lesson. Explore at your own pace.")}
      />
      <p className="mb-5 text-sm text-on-surface-variant">
        {tr(
          "Play the sample or generate a private world from your lecture in Personal space.",
        )}
      </p>
      {z.adventureGenerationEnabled && (
        <article className={card + " mb-6 p-5 space-y-4"}>
          <h2 className="text-xl font-semibold">
            {tr("Generate from your lesson")}
          </h2>
          <p className="text-sm text-on-surface-variant">
            {tr(
              "One daily message. PDF: up to 10 MB and 40 pages. Review the preview before exploring.",
            )}
          </p>
          <label className="block">
            {tr("Choose a lecture")}
            <select
              className="block w-full bg-surface-container p-3 rounded-lg"
              value={lecture}
              onChange={(e) => {
                setLecture(e.target.value);
                setFile(null);
              }}
            >
              <option value="">—</option>
              {(z.state.lectures || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {tr("Or upload a PDF")}
            <input
              className="block w-full text-sm py-3"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setLecture("");
              }}
            />
          </label>
          {z.adventureGenerationProgress ? (
            <div role="status" className="space-y-3">
              <p>
                {tr("Generating adventure…")}{" "}
                {stageLabel(z.adventureGenerationProgress)}
              </p>
              <button
                className={btn.secondary}
                onClick={z.cancelAdventureGeneration}
              >
                {tr("Cancel")}
              </button>
            </div>
          ) : (
            <button
              className={btn.primary}
              disabled={!lecture && !file}
              onClick={() =>
                void z.generateAdventure(file ?? { lectureId: lecture })
              }
            >
              {tr("Generate adventure")}
            </button>
          )}
          {z.adventureGenerationError && (
            <p role="alert" className="text-error">
              {tr(
                "Could not generate adventure. Check the source and try again.",
              )}
            </p>
          )}
          {z.adventureGenerationPreview && (
            <section className="rounded-lg bg-primary-container p-4 space-y-3">
              <h3 className="font-semibold">
                {z.adventureGenerationPreview.topic}
              </h3>
              <p>
                {z.adventureGenerationPreview.theme} ·{" "}
                {z.adventureGenerationPreview.missionCount} {tr("Missions")}
              </p>
              <ul className="list-disc pl-5">
                {z.adventureGenerationPreview.objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
              <p>
                {tr(
                  "Generated worlds support exploration. Puzzle checking is coming soon.",
                )}
              </p>
              <Link
                className={btn.primary}
                to={"/adventures/" + z.adventureGenerationPreview.id}
              >
                {tr("Explore world")}
              </Link>
            </section>
          )}
        </article>
      )}
      {z.generatedAdventures.length > 0 && (
        <div className="grid gap-4 mb-6">
          {z.generatedAdventures.map((a) => (
            <article
              key={a.id}
              className={card + " p-4 flex flex-wrap gap-3 justify-between"}
            >
              <h2>{a.title}</h2>
              <Link className={btn.secondary} to={"/adventures/" + a.id}>
                {tr("Explore world")}
              </Link>
            </article>
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {adventures.map((adventure) => (
          <article
            key={adventure.id}
            className={card + " overflow-hidden ring-1 ring-outline-variant"}
          >
            <div
              className="relative h-36 bg-primary-container flex items-center justify-center gap-3 overflow-hidden"
              aria-hidden="true"
            >
              <span className="text-5xl text-primary/70 font-mono">01</span>
              <Icon
                name="castle"
                className="text-7xl text-on-primary-container"
              />
              <span className="text-5xl text-primary/70 font-mono">10</span>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-primary-container text-on-primary-container px-2 py-1">
                  {tr("Sample adventure")}
                </span>
                <span className="rounded-full bg-surface-container text-on-surface-variant px-2 py-1">
                  {tr("Exploration preview")}
                </span>
              </div>
              <h2 className="text-xl font-semibold text-on-surface">
                {adventure.title}
              </h2>
              <p className="text-on-surface-variant">{adventure.description}</p>
              <p className="text-sm text-on-surface-variant">
                {tr("Keyboard and touch · No AI quota used")}
              </p>
              <Link
                to={`/adventures/${adventure.id}`}
                className={btn.primary + " min-h-11"}
              >
                <Icon name="explore" />
                {tr("Explore world")}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
