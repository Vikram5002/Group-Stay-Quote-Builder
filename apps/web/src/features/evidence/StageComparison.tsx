import { Badge, Card } from '../../components';
import { DELTA, STAGES } from './stages';
import type { Coverage } from './stages';

const COVERAGE: Record<Coverage, { label: string; tone: 'success' | 'neutral' | 'info' }> = {
  yes: { label: 'Yes', tone: 'success' },
  no: { label: 'No', tone: 'neutral' },
  agreed: { label: 'Agreed to add', tone: 'info' },
};

/** Baseline, negotiated scope and final evidence side by side, so the delta is plain to see. */
export function StageComparison() {
  return (
    <section aria-labelledby="stages" className="flex flex-col gap-4">
      <h2 id="stages" className="text-lg font-semibold">
        Three stages
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STAGES.map((stage, index) => (
          <li key={stage.id}>
            <Card title={`${index + 1}. ${stage.title}`} className="h-full">
              <p className="text-sm">{stage.summary}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-muted">Tag</dt>
                <dd className="font-mono text-xs">{stage.tag}</dd>
                <dt className="text-ink-muted">Files</dt>
                <dd className="font-mono text-xs">{stage.path}</dd>
              </dl>
              <p className="mt-3 text-sm font-semibold">Expected contents</p>
              <ul className="list-disc pl-5 text-sm">
                {stage.artifacts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p className="mt-3">
                {stage.provided ? (
                  <Badge tone="success">Provided</Badge>
                ) : (
                  <Badge tone="unknown">Awaiting files from Track 4</Badge>
                )}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">What each stage covers</caption>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Capability
              </th>
              {STAGES.map((stage) => (
                <th key={stage.id} scope="col" className="px-4 py-3 font-semibold">
                  {stage.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DELTA.map((row) => (
              <tr key={row.capability} className="border-t border-border">
                <th scope="row" className="px-4 py-3 font-medium">
                  {row.capability}
                </th>
                {(['baseline', 'scope', 'final'] as const).map((stage) => (
                  <td key={stage} className="px-4 py-3">
                    <Badge tone={COVERAGE[row[stage]].tone}>{COVERAGE[row[stage]].label}</Badge>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
