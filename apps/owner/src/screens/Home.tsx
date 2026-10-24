import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  getCampaignAudience,
  getProfile,
  getReports,
  listAudit,
  listCampaigns,
  listRewards,
  listRules,
  listStaff,
  type AuditEntry,
  type Audience,
  type Campaign,
  type Profile,
  type Reports,
  type Reward,
  type RuleRow,
  type StaffMember,
} from '../api';
import { ownerMessage } from '../errors';
import { formatTimestamp } from '../format';
import type { Tab } from '../Shell';

/**
 * The store's home screen (brief §4.2): the few numbers that matter, one
 * honest chart, what needs a decision, the setup checklist, the latest
 * actions and the last campaign. Everything comes from endpoints that
 * already exist; nothing here is invented.
 */

interface HomeProps {
  token: string;
  storeId: string;
  onNavigate: (tab: Tab) => void;
}

const ACTION_LABELS: Record<string, string> = {
  'rule.create': 'Rule created',
  'rule.version': 'Rule changed',
  'rule.status': 'Rule paused or resumed',
  'points.adjust': 'Points adjusted',
  'points.award': 'Points awarded',
  'points.redeem': 'Reward redeemed',
  'points.expire': 'Points expired',
  'points.fraud_clawback': 'Points clawed back',
  'reward.create': 'Reward created',
  'reward.edit': 'Reward changed',
  'branch.create': 'Branch added',
  'discount.set': 'Discount changed',
  'sale.reversal': 'Sale reversed',
  'staff.invite': 'Staff invited',
  'campaign.send': 'Campaign sent',
  'store.profile': 'Store profile changed',
  'store.create': 'Store created',
};

const points = (value: number): string => value.toLocaleString('fi-FI');

const shortDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const relative = (iso: string): string => {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export function HomeScreen({ token, storeId, onNavigate }: HomeProps) {
  const [reports, setReports] = useState<Reports | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      getReports(token, storeId),
      listRules(token, storeId),
      listRewards(token, storeId),
      listStaff(token, storeId),
      getProfile(token, storeId),
      listAudit(token, storeId, '8'),
      listCampaigns(token, storeId),
      getCampaignAudience(token, storeId),
    ]);

    const failure = results.find((result) => result.status === 'rejected');
    if (failure !== undefined && failure.status === 'rejected') {
      const caught: unknown = failure.reason;
      setError(
        caught instanceof ApiError
          ? ownerMessage(caught.code)
          : 'Some of this page could not load. Check your connection.',
      );
    } else {
      setError(null);
    }

    const [reportsResult, rulesResult, rewardsResult, staffResult, profileResult, auditResult, campaignResult, audienceResult] =
      results;

    if (reportsResult.status === 'fulfilled') setReports(reportsResult.value);
    if (rulesResult.status === 'fulfilled') setRules(rulesResult.value.rules);
    if (rewardsResult.status === 'fulfilled') setRewards(rewardsResult.value.rewards);
    if (staffResult.status === 'fulfilled') setStaff(staffResult.value.members);
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value.entries);
    if (campaignResult.status === 'fulfilled') setCampaigns(campaignResult.value.campaigns);
    if (audienceResult.status === 'fulfilled') setAudience(audienceResult.value);
    setLoading(false);
  }, [token, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeRules = rules.filter((rule) => rule.status === 'active');
  const activeRewards = rewards.filter((reward) => reward.active);
  const pausedRules = rules.filter((rule) => rule.status === 'paused');
  const pausedRewards = rewards.filter((reward) => !reward.active);
  const pendingStaff = staff.filter((member) => member.status !== 'active');
  const cashiers = staff.filter((member) => member.role === 'cashier');

  const checklist = useMemo(
    () => [
      {
        done: (profile?.address ?? '') !== '' || (profile?.contactEmail ?? '') !== '',
        title: 'Fill in your store profile',
        body: 'Address, contact and brand colour — this is the customer’s store page.',
        tab: 'profile' as Tab,
      },
      {
        done: activeRules.length > 0,
        title: 'Set your earning rule',
        body: 'How many points a purchase earns.',
        tab: 'rules' as Tab,
      },
      {
        done: activeRewards.length > 0,
        title: 'Add your first reward',
        body: 'What customers can spend their points on.',
        tab: 'rewards' as Tab,
      },
      {
        done: cashiers.length > 0,
        title: 'Invite a cashier',
        body: 'The person who awards points at the counter.',
        tab: 'people' as Tab,
      },
      {
        done: false,
        title: 'Print the counter sign',
        body: 'Put your Poket code where customers can see it.',
        tab: 'sign' as Tab,
      },
    ],
    [profile, activeRules.length, activeRewards.length, cashiers.length],
  );

  const setupDone = checklist.slice(0, 4).every((item) => item.done);
  const lastCampaign = campaigns[0] ?? null;
  const attention: {
    tone: 'warn' | 'bad' | 'good';
    icon: string;
    title: string;
    body: string;
    tab: Tab;
    action: string;
  }[] = [];

  if (activeRules.length === 0) {
    attention.push({
      tone: 'bad',
      icon: '!',
      title: 'No earning rule is active',
      body: 'The till cannot award points until a rule is running.',
      tab: 'rules',
      action: 'Open rules',
    });
  }
  if (pausedRules.length > 0 && activeRules.length > 0) {
    attention.push({
      tone: 'warn',
      icon: '❙❙',
      title: `${pausedRules.length} rule${pausedRules.length === 1 ? '' : 's'} paused`,
      body: 'Paused rules earn nothing until resumed.',
      tab: 'rules',
      action: 'Review rules',
    });
  }
  if (pausedRewards.length > 0) {
    attention.push({
      tone: 'warn',
      icon: '✦',
      title: `${pausedRewards.length} reward${pausedRewards.length === 1 ? '' : 's'} paused`,
      body: 'Customers cannot spend points on a paused reward.',
      tab: 'rewards',
      action: 'Review rewards',
    });
  }
  if (pendingStaff.length > 0) {
    attention.push({
      tone: 'warn',
      icon: '♙',
      title: `${pendingStaff.length} invitation${pendingStaff.length === 1 ? '' : 's'} not accepted`,
      body: 'A person who never signed in cannot award points yet.',
      tab: 'people',
      action: 'Open people',
    });
  }
  if (audience !== null && audience.linked > 0 && audience.optedIn === 0) {
    attention.push({
      tone: 'good',
      icon: '◈',
      title: 'No one has opted in to store news',
      body: 'Customers turn store news on from their Poket app. Until then a campaign reaches no one.',
      tab: 'campaigns',
      action: 'Open campaigns',
    });
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <section>
      {error !== null && <p className="error">{error}</p>}

      <div className="pagehead">
        <div>
          <h1>Overview</h1>
          <p className="sub">
            {today} · {loading ? 'Updating…' : 'Updated just now'}
          </p>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={() => onNavigate('profile')}>
            Preview store page
          </button>
          <button className="primary" type="button" onClick={() => onNavigate('campaigns')}>
            Create campaign
          </button>
        </div>
      </div>

      <div className="statstrip">
        <div className="stat">
          <p className="statlabel">Customers</p>
          <p className="statvalue">{points(reports?.customers ?? 0)}</p>
          <p className="statfoot">{points(reports?.newCustomers30d ?? 0)} joined in 30 days</p>
        </div>
        <div className="stat">
          <p className="statlabel">Visits · 30 days</p>
          <p className="statvalue">{points(reports?.visits30d ?? 0)}</p>
          <p className="statfoot">Sales recorded at the till</p>
        </div>
        <div className="stat">
          <p className="statlabel">Points issued</p>
          <p className="statvalue">{points(reports?.pointsIssued30d ?? 0)}</p>
          <p className="statfoot">{points(reports?.pointsRedeemed30d ?? 0)} redeemed</p>
        </div>
        <div className="stat">
          <p className="statlabel">Points expired</p>
          <p className="statvalue">{points(reports?.pointsExpired30d ?? 0)}</p>
          <p className="statfoot">Left balances in 30 days</p>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="grid" style={{ gap: 16 }}>
          {reports !== null && <ActivityChart reports={reports} />}

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Recent activity</h3>
                <p className="sub">Awards, redemptions and the changes staff made</p>
              </div>
              <button className="link" type="button" onClick={() => onNavigate('audit')}>
                Audit log ›
              </button>
            </div>

            {audit.length === 0 ? (
              <p className="emptynote">
                Nothing has happened yet. Your first award will appear here.
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>What</th>
                    <th>By</th>
                    <th>When</th>
                    <th className="num">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.slice(0, 6).map((entry) => {
                    const after = entry.after as Record<string, unknown> | null;
                    const detail =
                      entry.action === 'points.award' || entry.action === 'points.adjust'
                        ? Number(after?.points ?? 0)
                        : entry.action === 'campaign.send'
                          ? Number(after?.recipients ?? 0)
                          : 0;
                    return (
                      <tr key={entry.id}>
                        <td>
                          <strong style={{ fontWeight: 650 }}>
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </strong>
                        </td>
                        <td className="muted">{entry.actorEmail ?? 'system'}</td>
                        <td className="mono" title={formatTimestamp(entry.createdAt)}>
                          {relative(entry.createdAt)}
                        </td>
                        <td className="num">
                          {detail > 0 ? (
                            <span className={entry.action === 'points.adjust' ? '' : 'positive'}>
                              {entry.action === 'campaign.send' ? `${detail} sent` : `+${detail}`}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>
                  Needs attention{' '}
                  {attention.length > 0 && (
                    <span className="pill warn" style={{ marginLeft: 6 }}>
                      {attention.length}
                    </span>
                  )}
                </h3>
                <p className="sub">Only what the data says is wrong</p>
              </div>
            </div>

            {attention.length === 0 ? (
              <div className="callout" style={{ marginBottom: 0 }}>
                <span className="ico" aria-hidden="true">
                  ✓
                </span>
                <p>
                  Everything is running. Rules are active, rewards are available and{' '}
                  {pendingStaff.length === 0 ? 'the team is set up' : 'invitations are pending'}.
                </p>
              </div>
            ) : (
              <div className="attention">
                {attention.map((item) => (
                  <div className="item" key={item.title}>
                    <span
                      className={
                        item.tone === 'bad' ? 'tile bad' : item.tone === 'good' ? 'tile good' : 'tile'
                      }
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                    <span className="act">
                      <button className="link" type="button" onClick={() => onNavigate(item.tab)}>
                        {item.action} ›
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!setupDone && (
            <div className="panel">
              <div className="panelhead">
                <div>
                  <h3>Set up your store</h3>
                  <p className="sub">
                    {checklist.filter((item) => item.done).length} of {checklist.length} done
                  </p>
                </div>
              </div>
              <ul className="checklist">
                {checklist.map((item) => (
                  <li key={item.title} className={item.done ? 'done' : ''}>
                    <span className="state" aria-hidden="true">
                      {item.done ? '✓' : ''}
                    </span>
                    <span className="txt">
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </span>
                    {!item.done && (
                      <button className="link" type="button" onClick={() => onNavigate(item.tab)}>
                        Open ›
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel">
            <div className="panelhead">
              <div>
                <h3>Last campaign</h3>
                <p className="sub">Delivered inside the Poket app</p>
              </div>
              <button className="link" type="button" onClick={() => onNavigate('campaigns')}>
                All campaigns ›
              </button>
            </div>

            {lastCampaign === null ? (
              <p className="emptynote">
                No campaigns yet. Write one short message and it lands in your customers’ Poket
                inbox.
              </p>
            ) : (
              <>
                <p className="eyebrow">{relative(lastCampaign.createdAt)}</p>
                <p style={{ fontWeight: 650, margin: '6px 0 2px' }}>{lastCampaign.title}</p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {lastCampaign.body}
                </p>
                <div className="segcap" style={{ marginTop: 10 }}>
                  <span>
                    {lastCampaign.opened} of {lastCampaign.recipients} opened
                  </span>
                  <span>
                    {lastCampaign.recipients === 0
                      ? 'No one reached'
                      : `${Math.round((lastCampaign.opened / lastCampaign.recipients) * 100)}%`}
                  </span>
                </div>
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuenow={
                    lastCampaign.recipients === 0
                      ? 0
                      : Math.round((lastCampaign.opened / lastCampaign.recipients) * 100)
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i
                    style={{
                      width: `${
                        lastCampaign.recipients === 0
                          ? 0
                          : Math.round((lastCampaign.opened / lastCampaign.recipients) * 100)
                      }%`,
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="panel tint">
            <div className="panelhead">
              <div>
                <h3>Plan</h3>
                <p className="sub">Pilot</p>
              </div>
            </div>
            <p style={{ fontSize: 13, margin: 0 }}>
              Your plan and billing are arranged directly with Poket during the pilot. In-app
              billing arrives after the pilot.
            </p>
            <button
              className="ghost small"
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => onNavigate('billing')}
            >
              Plan and billing
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityChart({ reports }: { reports: Reports }) {
  const series = reports.series;
  const maxPoints = Math.max(1, ...series.map((point) => Math.max(point.issued, point.redeemed)));
  const maxVisits = Math.max(1, ...series.map((point) => point.visits));
  const width = 600;
  const height = 130;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const line = series
    .map((point, index) => `${index * step},${height - (point.visits / maxVisits) * height}`)
    .join(' ');

  return (
    <div className="panel">
      <div className="panelhead">
        <div>
          <h3>Loyalty activity</h3>
          <p className="sub">Last 30 days · points and visits</p>
        </div>
        <div className="legend">
          <span>
            <i className="swatch green" aria-hidden="true" /> Issued
          </span>
          <span>
            <i className="swatch amber" aria-hidden="true" /> Redeemed
          </span>
          <span>
            <i className="swatch blue" aria-hidden="true" /> Visits
          </span>
        </div>
      </div>

      <div className="chart" role="img" aria-label="Points issued, redeemed and visits over 30 days">
        <div className="chartbars">
          {series.map((point) => (
            <div
              className="chartday"
              key={point.date}
              title={`${shortDate(point.date)}: ${point.issued} issued, ${point.redeemed} redeemed, ${point.visits} visits`}
            >
              <i
                className="bar green"
                style={{ height: `${Math.max(2, (point.issued / maxPoints) * 100)}%` }}
              />
              <i
                className="bar amber"
                style={{ height: `${Math.max(2, (point.redeemed / maxPoints) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <svg
          className="chartline"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={line} fill="none" stroke="var(--info)" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="chartlabels">
        <span>{shortDate(series[0]?.date ?? '')}</span>
        <span>{shortDate(series[Math.floor(series.length / 2)]?.date ?? '')}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
