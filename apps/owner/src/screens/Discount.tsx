import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, getDiscountRule, setDiscountRule, type DiscountRule } from '../api';
import { ownerMessage } from '../errors';
import { euroText, parseAmountToCents } from '../format';

/** Empty box = the discount is paused. */
type Kind = 'fixed_cents' | 'percent';

export function DiscountScreen({ token, storeId }: { token: string; storeId: string }) {
  const [rule, setRule] = useState<DiscountRule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [threshold, setThreshold] = useState('');
  const [kind, setKind] = useState<Kind>('fixed_cents');
  const [value, setValue] = useState('');
  const [active, setActive] = useState(true);

  const load = useCallback(async () => {
    try {
      const got = await getDiscountRule(token, storeId);
      const found = got.rule;
      setRule(found);
      if (found) {
        setThreshold((found.thresholdCents / 100).toFixed(2).replace('.', ','));
        setKind(found.kind);
        setValue(found.kind === 'fixed_cents' ? (found.value / 100).toFixed(2).replace('.', ',') : String(found.value / 1000));
        setActive(found.active);
      }
      setLoaded(true);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const thresholdCents = parseAmountToCents(threshold);
    if (thresholdCents === null) {
      setError('The threshold has to be an amount in euros.');
      return;
    }
    let parsedValue: number;
    if (kind === 'fixed_cents') {
      const cents = parseAmountToCents(value);
      if (cents === null || cents <= 0) {
        setError('The discount has to be an amount above zero.');
        return;
      }
      parsedValue = cents;
    } else {
      const percent = Number.parseFloat(value.replace(',', '.'));
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        setError('The percent has to be between 0 and 100.');
        return;
      }
      parsedValue = Math.round(percent * 1000);
    }

    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const saved = await setDiscountRule(token, storeId, {
        thresholdCents,
        kind,
        value: parsedValue,
        active,
      });
      setRule(saved);
      setFlash('Discount saved.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'Could not save it.');
    } finally {
      setBusy(false);
    }
  };

  const ruleLine = (found: DiscountRule): string =>
    found.kind === 'fixed_cents'
      ? `${euroText(found.value)} off purchases of ${euroText(found.thresholdCents)} or more`
      : `${found.value / 1000}% off purchases of ${euroText(found.thresholdCents)} or more`;

  return (
    <section>
      <div className="pagehead">
        <h1>Discount</h1>
      </div>

      <p className="muted">
        One discount per store: when a customer's basket reaches the threshold, they can spend a
        code from their app and the discount comes off what they pay. The customer shows a fresh
        code from their phone each time — it works once, for about a minute.
      </p>

      {error !== null && <p className="error">{error}</p>}
      {flash !== null && <p className="flash">{flash}</p>}

      {loaded && rule !== null && (
        <p>
          Today: {ruleLine(rule)}{' '}
          <span className={rule.active ? 'chip active' : 'chip pending'}>
            {rule.active ? 'Offered' : 'Paused'}
          </span>
        </p>
      )}
      {loaded && rule === null && <p className="emptynote">No discount set yet.</p>}

      <form className="form" onSubmit={(event) => void handleSave(event)}>
        <h3>{rule === null ? 'Set the discount' : 'Change the discount'}</h3>

        <label htmlFor="discount-threshold">Basket reaches (€)</label>
        <input
          id="discount-threshold"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          placeholder="20,00"
          inputMode="decimal"
          disabled={busy}
        />

        <label htmlFor="discount-kind">Kind</label>
        <select
          id="discount-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
          disabled={busy}
        >
          <option value="fixed_cents">A fixed amount off</option>
          <option value="percent">A percent off</option>
        </select>

        <label htmlFor="discount-value">{kind === 'fixed_cents' ? 'Amount off (€)' : 'Percent off'}</label>
        <input
          id="discount-value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={kind === 'fixed_cents' ? '2,00' : '5'}
          inputMode="decimal"
          disabled={busy}
        />

        <label className="checkline">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={busy}
          />
          Offer this discount
        </label>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save discount'}
        </button>
      </form>

      <p className="muted small">
        The discount is funded by the store in its own till — Poket only quotes it and records it
        on the sale. The customer's code is verified online and works once; there is no offline
        discount.
      </p>
    </section>
  );
}
