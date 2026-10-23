
/**
 * The honest placeholders: the panels that switch on when the platform
 * does — billing with Stripe, invitations with the email sender. They show
 * what will be here, and say plainly that it is not live yet.
 */
export function SettingsScreen() {
  return (
    <section>
      <div className="sectionhead">
        <h2>Settings</h2>
      </div>

      <div className="placeholdercard">
        <h3>Billing</h3>
        <p className="muted">
          Your plan, usage and invoices will appear here when the platform switches billing on.
          Until then this store runs on the pilot arrangement — nothing to pay, nothing owed.
        </p>
        <p className="chip pending">Starts with the platform's billing</p>
      </div>

      <div className="placeholdercard">
        <h3>Staff invitations by email</h3>
        <p className="muted">
          Inviting managers and cashiers by email lands here once the platform has its email
          sender. Today the platform admin links people to your store — ask them.
        </p>
        <p className="chip pending">Needs the platform's email sender</p>
      </div>

      <div className="placeholdercard">
        <h3>Store page editor: logo</h3>
        <p className="muted">
          Your logo image joins the brand colour when image storage is switched on. The colour
          and name already reach the customer app — set them under Store profile.
        </p>
        <p className="chip pending">Needs image storage</p>
      </div>
    </section>
  );
}
