import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getCampaignAudience,
  listRewards,
  listRules,
  listStaff,
  type Audience,
  type Reward,
  type RuleRow,
  type StaffMember,
} from '../api';
import { ownerMessage } from '../errors';
import type { Tab } from '../Shell';

interface Notice {
  id: string;
  tone: 'warn' | 'bad' | 'info' | 'good';
  icon: string;
  title: string;
  body: string;
  tab: Tab;
  action: string;
}

/**
 * Store notifications are computed from the store's own data, not pushed
 * from a message queue: a paused rule, an invitation nobody accepted, an
 * audience of nobody. That keeps every line true and actionable.
 */
export function NotificationsScreen({
  token,
  storeId,
  onNavigate,
}: {
  token: string;
  storeId: string;
  onNavigate: (tab: Tab) => void;
}) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleList, rewardList, staffList, reach] = await Promise.all([
        listRules(token, storeId),
        listRewards(token, storeId),
        listStaff(token, storeId),
        getCampaignAudience(token, storeId),
      ]);
      setRules(ruleList.rules);
      setRewards(rewardList.rewards);
      setStaff(staffList.members);
      setAudience(reach);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? ownerMessage(caught.code) : 'The API is not reachable.');
    } finally {
      setLoading(false);
    }
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const notices: Notice[] = [];
  const activeRules = rules.filter((rule) => rule.status === 'active');
  const pausedRules = rules.filter((rule) => rule.status === 'paused');
  const pausedRewards = rewards.filter((reward) => !reward.active);
  const pending = staff.filter((member) => member.status !== 'active');

  if (activeRules.length === 0) {
    notices.push({
      id: 'no-rule',
      tone: 'bad',
      icon: '!',
      title: 'No earning rule is active',
      body: 'Customers earn nothing until a rule is running. Set one in Rules.',
      tab: 'rules',
      action: 'Open rules',
    });
  }

  for (const rule of pausedRules) {
    notices.push({
      id: `rule-${rule.ruleId}`,
      tone: 'warn',
      icon: '❙❙',
      title: 'A rule is paused',
      body: `${rule.definition.type === 'per_euro' ? 'Points-per-euro' : rule.definition.type === 'fixed_per_purchase' ? 'Fixed-points' : 'Visit-based'} rule is paused and earns nothing right now.`,
      tab: 'rules',
      action: 'Review rule',
    });
  }

  for (const reward of pausedRewards) {
    notices.push({
      id: `reward-${reward.rewardId}`,
      tone: 'warn',
      icon: '✦',
      title: `${reward.name} is paused`,
      body: 'Customers cannot spend points on it until it is active again.',
      tab: 'rewards',
      action: 'Open rewards',
    });
  }

  for (const member of pending) {
    notices.push({
      id: `staff-${member.memberId}`,
      tone: 'info',
      icon: '♙',
      title: `${member.email} has not signed in yet`,
      body: 'The invitation stands. A person who never signs in cannot award points at the till.',
      tab: 'people',
      action: 'Open people',
    });
  }

  if (audience !== null && audience.linked > 0 && audience.optedIn === 0) {
    notices.push({
      id: 'no-consent',
      tone: 'info',
      icon: '◈',
      title: 'Campaigns currently reach no one',
      body: `All ${audience.linked} linked customers have store news switched off. They can turn it on in the Poket app.`,
      tab: 'campaigns',
      action: 'Open campaigns',
    });
  }

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Notifications</h1>
          <p className="sub">What your store’s own data says needs a look</p>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {notices.length === 0 && !loading ? (
        <div className="panel">
          <div className="callout" style={{ marginBottom: 0 }}>
            <span className="ico" aria-hidden="true">
              ✓
            </span>
            <p>
              Nothing needs you. Rules, rewards and the team are all in order, and campaigns can
              reach your customers.
            </p>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="attention">
            {notices.map((notice) => (
              <div className="item" key={notice.id}>
                <span
                  className={
                    notice.tone === 'bad'
                      ? 'tile bad'
                      : notice.tone === 'warn'
                        ? 'tile'
                        : 'tile good'
                  }
                  aria-hidden="true"
                >
                  {notice.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{notice.title}</strong>
                  <p>{notice.body}</p>
                </div>
                <span className="act">
                  <button className="link" type="button" onClick={() => onNavigate(notice.tab)}>
                    {notice.action} ›
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        This page reads your store’s data each time it opens. Campaign read receipts are on the
        Campaigns page; payment notices arrive when billing is connected.
      </p>
    </section>
  );
}
