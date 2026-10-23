import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createRule,
  createRuleRequestFor,
  editRuleVersion,
  listRules,
  setRuleStatus,
  simulateRules,
  type RuleRow,
  type Simulation,
} from '../api';
import { ownerMessage } from '../errors';
import { euroText, parseAmountToCents, parsePerEuro, perEuroText } from '../format';

interface Definition {
  type: 'per_euro' | 'fixed_per_purchase' | 'threshold_bonus' | 'every_nth_visit';
  pointsPerEuroThousandths?: number;
  points?: number;
  everyN?: number;
  rounding?: 'floor' | 'nearest';
  minSpendCents?: number;
}

/** One line a shop can read: what the rule gives and when it applies. */
function definitionText(definition: Definition): string {
  const minimum =
    definition.minSpendCents !== undefined && definition.type !== 'every_nth_visit'
      ? ` on purchases of ${euroText(definition.minSpendCents)} or more`
      : '';
  switch (definition.type) {
    case 'per_euro':
      return `${perEuroText(definition.pointsPerEuroThousandths ?? 0)} pt per €${minimum}`;
    case 'fixed_per_purchase':
      return `+${definition.points} pts per purchase${minimum}`;
    case 'threshold_bonus':
      return `+${definition.points} bonus pts${minimum}`;
    case 'every_nth_visit':
      return `+${definition.points} pts on every ${definition.everyN}ᵗʰ visit`;
  }
}

const RULE_TYPES = [
  { value: 'per_euro', label: 'Points per euro' },
  { value: 'fixed_per_purchase', label: 'Fixed points per purchase' },
  { value: 'threshold_bonus', label: 'Bonus when the purchase reaches a sum' },
  { value: 'every_nth_visit', label: 'Bonus on every Nth visit' },
] as const;

/** Which visit the customer is on, when the draft has an every-Nth rule. */
const MAX_VISIT_IN_TRY = 10_000;

export function RulesScreen({ token, storeId }: { token: string; storeId: string }) {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editorFor, setEditorFor] = useState<RuleRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await listRules(token, storeId)).rules);
      setLoadError(null);
    } catch (caught) {
      setLoadError(
        caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.',
      );
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rules = rows ?? [];
  const current = rules.filter((row) => row.status !== 'superseded');
  const history = rules.filter((row) => row.status === 'superseded');
  const activeCount = current.filter((row) => row.status === 'active').length;

  const handleStatus = async (rule: RuleRow, next: 'active' | 'paused') => {
    try {
      const updated = await setRuleStatus(token, storeId, rule.ruleId, next);
      setRows((rows ?? []).map((row) => (row.ruleId === updated.ruleId ? updated : row)));
      setFlash(
        next === 'paused' ? 'Rule paused. The till stops using it at once.' : 'Rule is active again.',
      );
    } catch (caught) {
      setFlash(caught instanceof ApiError ? ownerMessage(caught.code) : 'Try again.');
    }
  };

  return (
    <section>
      <div className="sectionhead">
        <div>
          <h2>How points are calculated</h2>
          <p className="muted">
            {activeCount === 0
              ? 'No rule is active: the till is not awarding points.'
              : `${activeCount} active rule${activeCount === 1 ? '' : 's'}. A purchase matches every rule it qualifies for, and the totals add up.`}
          </p>
        </div>
        {editorOpen ? (
          <button className="ghost" type="button" onClick={() => setEditorOpen(false)}>
            Close editor
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            onClick={() => {
              setEditorFor(null);
              setEditorOpen(true);
            }}
          >
            New rule
          </button>
        )}
      </div>

      {loadError !== null && <p className="error">{loadError}</p>}
      {flash !== null && <p className="oknote">{flash}</p>}

      {rows !== null && (
        <div className="stack">
          {current.map((rule) => (
            <RuleCard
              key={rule.ruleId}
              rule={rule}
              onPause={() => void handleStatus(rule, 'paused')}
              onResume={() => void handleStatus(rule, 'active')}
              onEdit={() => {
                setEditorFor(rule);
                setEditorOpen(true);
              }}
            />
          ))}
          {current.length === 0 && rows.length > 0 && (
            <p className="emptynote">Every rule is paused. Resume one, or make a new one.</p>
          )}
          {rows.length === 0 && (
            <p className="emptynote">
              No rules yet. The till awards nothing until you add the first one.
            </p>
          )}
        </div>
      )}

      {editorOpen && (
        <RuleEditor
          base={editorFor}
          token={token}
          storeId={storeId}
          onClose={() => setEditorOpen(false)}
          onDone={(message) => {
            setEditorOpen(false);
            setFlash(message);
            void load();
          }}
        />
      )}

      <History historySorted={history} />
    </section>
  );
}

function RuleCard({
  rule,
  onPause,
  onResume,
  onEdit,
}: {
  rule: RuleRow;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="card rulecard">
      <div className="rulemain">
        <div>
          <p className={rule.status === 'active' ? 'chip active' : 'chip paused'}>
            {rule.status === 'active' ? 'Active' : 'Paused'} · version {rule.version}
          </p>
          <p className="ruletext">{definitionText(rule.definition as Definition)}</p>
          <p className="muted small">
            Running from {new Date(rule.effectiveFrom).toLocaleString()}
          </p>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={onEdit}>
            Change
          </button>
          {rule.status === 'active' ? (
            <button className="ghost danger" type="button" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button className="primary" type="button" onClick={onResume}>
              Resume
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The editor is the same form for making and changing a rule: changing a
 * rule is saving it as the store's next version (FR-RUL-4). "Try it" runs
 * the draft through the engine without saving, through the simulate
 * endpoint.
 */
function RuleEditor({
  base,
  token,
  storeId,
  onClose,
  onDone,
}: {
  base: RuleRow | null;
  token: string;
  storeId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const initial = base?.definition as Definition | undefined;
  const [type, setType] = useState<Definition['type']>(initial?.type ?? 'per_euro');
  const [pointsPerEuro, setPointsPerEuro] = useState(
    initial === undefined || initial.type !== 'per_euro'
      ? '1'
      : perEuroText(initial.pointsPerEuroThousandths ?? 1000),
  );
  const [points, setPoints] = useState(String(initial?.points ?? 5));
  const [everyN, setEveryN] = useState(String(initial?.everyN ?? 3));
  const [rounding, setRounding] = useState<'floor' | 'nearest'>(initial?.rounding ?? 'floor');
  const [minSpend, setMinSpend] = useState(
    initial === undefined || initial.minSpendCents === undefined
      ? ''
      : euroText(initial.minSpendCents),
  );
  const [visitNumber, setVisitNumber] = useState('3');
  const [testAmount, setTestAmount] = useState('12,50');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const build = (): Definition | null => {
    const parsedMinimum = minSpend.trim() === '' ? undefined : parseAmountToCents(minSpend);
    if (parsedMinimum === null) return null;
    const minSpendCents = parsedMinimum;
    if (type === 'per_euro') {
      const thousandths = parsePerEuro(pointsPerEuro);
      if (thousandths === null || thousandths < 1) return null;
      return {
        type,
        pointsPerEuroThousandths: thousandths,
        rounding,
        ...(minSpendCents === undefined ? {} : { minSpendCents }),
      };
    }
    const pointsValue = Number(points);
    if (!Number.isInteger(pointsValue) || pointsValue < 1) return null;
    if (type === 'every_nth_visit') {
      const n = Number(everyN);
      if (!Number.isInteger(n) || n < 2) return null;
      return { type, points: pointsValue, everyN: n };
    }
    return {
      type,
      points: pointsValue,
      ...(minSpendCents === undefined ? {} : { minSpendCents }),
    };
  };

  const definition = useMemo(build, [type, pointsPerEuro, points, everyN, rounding, minSpend]);

  const save = async () => {
    if (definition === null) {
      setProblem('The rule is not complete yet.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const body = createRuleRequestFor(definition);
      if (base === null) {
        await createRule(token, storeId, body);
        onDone('Rule saved. The till uses it now.');
      } else {
        await editRuleVersion(token, storeId, base.ruleId, body);
        onDone('Saved as a new version. The previous one waits in the history below.');
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'INVALID_RULE') {
        setProblem(caught.message);
      } else {
        setProblem(caught instanceof ApiError ? ownerMessage(caught.code) : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    if (definition === null) {
      setProblem('The rule is not complete yet.');
      return;
    }
    const cents = parseAmountToCents(testAmount);
    if (cents === null) {
      setProblem('Type a test amount like 12,50.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result: Simulation = await simulateRules(token, storeId, {
        amountCents: cents,
        rules: [definition],
        ...(type === 'every_nth_visit'
          ? { visitNumber: Math.max(1, Math.min(MAX_VISIT_IN_TRY, Number(visitNumber) || 1)) }
          : {}),
      });
      setNotice(
        result.awarded
          ? `On ${euroText(cents)} this rule would give ${result.points} points.`
          : `On ${euroText(cents)} this rule would award nothing: ${
              result.reason === 'below_minimum' ? 'below the minimum' : 'the condition was not met'
            }.`,
      );
    } catch (caught) {
      setProblem(caught instanceof ApiError ? ownerMessage(caught.code) : 'Simulation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>{base === null ? 'New rule' : `Change rule · version ${base.version}`}</h3>
      <p className="muted small">
        A store can have several rules; the till adds up every rule a purchase qualifies
        for, and the store-wide ceiling (set by the platform) can cap the total.
      </p>

      <label htmlFor="rule-type">Kind of rule</label>
      <select
        id="rule-type"
        value={type}
        onChange={(event) => setType(event.target.value as Definition['type'])}
      >
        {RULE_TYPES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>

      {type === 'per_euro' && (
        <>
          <label htmlFor="rule-rate">Points per euro</label>
          <input
            id="rule-rate"
            value={pointsPerEuro}
            onChange={(event) => setPointsPerEuro(event.target.value)}
            placeholder="1"
            inputMode="decimal"
          />
          <label htmlFor="rule-rounding">Rounding</label>
          <select
            id="rule-rounding"
            value={rounding}
            onChange={(event) => setRounding(event.target.value as 'floor' | 'nearest')}
          >
            <option value="floor">Down (0.9 points becomes 0)</option>
            <option value="nearest">Nearest (0.5 points becomes 1)</option>
          </select>
        </>
      )}

      {type !== 'per_euro' && (
        <>
          <label htmlFor="rule-points">Points to give</label>
          <input
            id="rule-points"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="5"
            inputMode="numeric"
          />
        </>
      )}

      {type === 'every_nth_visit' && (
        <>
          <label htmlFor="rule-everyn">Award on every Nth visit</label>
          <input
            id="rule-everyn"
            value={everyN}
            onChange={(event) => setEveryN(event.target.value)}
            placeholder="3"
            inputMode="numeric"
          />
          <label htmlFor="rule-visit">Visit number to try in the test</label>
          <input
            id="rule-visit"
            value={visitNumber}
            onChange={(event) => setVisitNumber(event.target.value)}
            placeholder="3"
            inputMode="numeric"
          />
        </>
      )}

      {type !== 'every_nth_visit' && (
        <>
          <label htmlFor="rule-minspend">Minimum purchase (blank for none)</label>
          <input
            id="rule-minspend"
            value={minSpend}
            onChange={(event) => setMinSpend(event.target.value)}
            placeholder="5.00"
            inputMode="decimal"
          />
        </>
      )}

      <div className="tryrow">
        <div className="tryfield">
          <label htmlFor="rule-test">Test with a purchase of (€)</label>
          <input
            id="rule-test"
            value={testAmount}
            onChange={(event) => setTestAmount(event.target.value)}
            inputMode="decimal"
          />
        </div>
        <button className="ghost" type="button" onClick={() => void tryIt()} disabled={busy}>
          Try it
        </button>
      </div>

      {problem !== null && <p className="error">{problem}</p>}
      {problem === null && notice !== null && <p className="oknote">{notice}</p>}

      <div className="actions">
        <button className="primary" type="submit" disabled={busy || definition === null}>
          {busy ? 'Saving…' : base === null ? 'Save rule' : 'Save as new version'}
        </button>
        <button className="ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function History({ historySorted }: { historySorted: RuleRow[] }) {
  if (historySorted.length === 0) return null;
  return (
    <section className="history">
      <h3>History</h3>
      <p className="muted small">
        Superseded versions stay exactly as they were: past awards were calculated by
        them, and the record of which version applied lives in the ledger (FR-RUL-4).
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Version</th>
            <th>What it gave</th>
            <th>Left service</th>
          </tr>
        </thead>
        <tbody>
          {historySorted.map((row) => (
            <tr key={row.ruleId}>
              <td>v{row.version}</td>
              <td>{definitionText(row.definition as Definition)}</td>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
