import type { SkillGroup, SkillsSection } from "@/lib/skills";

function SkillGroupBlock({ group }: { group: SkillGroup }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
        {group.title}
      </h4>
      <ul className="flex flex-wrap gap-1.5">
        {group.items.map((item) => (
          <li
            key={item}
            className="rounded-full border border-current/15 bg-current/[0.04] px-2.5 py-0.5 text-xs leading-5"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Skills as an AI-system lifecycle: numbered pipeline stages (data → models → production)
 * resting on a transversal foundation band. Pure server markup, no client JS.
 */
export function SkillsMap({ section }: { section: SkillsSection }) {
  const { stages, foundation } = section;

  return (
    <section className="mt-6" aria-labelledby="skills-title">
      <h2 id="skills-title" className="mb-2 text-xl font-semibold">
        {section.title}
      </h2>
      {section.intro && (
        <p className="mb-5 font-serif text-[18px] leading-[1.6] opacity-90">{section.intro}</p>
      )}

      <ol className="grid gap-6 md:grid-flow-col md:auto-cols-fr md:gap-4">
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1;
          return (
            <li
              key={stage.title}
              className="relative flex flex-col gap-4 rounded-xl border border-current/15 p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(88,125,177,1)] text-xs font-semibold text-white"
                >
                  {index + 1}
                </span>
                <h3 className="text-base font-semibold">{stage.title}</h3>
              </div>
              {stage.groups.map((group) => (
                <SkillGroupBlock key={group.title} group={group} />
              ))}
              {!isLast && (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-[22px] left-1/2 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-current/15 bg-background text-[11px] md:hidden"
                  >
                    ↓
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute -right-[18px] top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-current/15 bg-background text-[11px] md:flex"
                  >
                    →
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-xl border border-dashed border-current/25 bg-current/[0.03] p-4">
        <h3 className="mb-3 text-base font-semibold">{foundation.title}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {foundation.groups.map((group) => (
            <SkillGroupBlock key={group.title} group={group} />
          ))}
        </div>
      </div>
    </section>
  );
}
