# Email templates

## Sign-in code (`sign-in-code.html`)

The customer app signs in with a one-time code. Supabase sends it, so the
template must show `{{ .Token }}` as text — not only a confirmation link.

### Where it goes

Supabase dashboard → **Authentication → Emails → Magic Link**:

- **Subject:** `Your OmaPointii sign-in code`
- **Message body:** the whole of `sign-in-code.html`

Do not put the code in the subject line: it would appear on lock screens and
in notifications.

### Variables used

| Variable | Meaning |
| --- | --- |
| `{{ .Token }}` | the one-time code the customer types in the app |
| `{{ .Email }}` | the address being verified |
| `{{ .SiteURL }}` | the app URL from Supabase URL Configuration |

### Design notes

- All styles are inline and the layout is table-based, so Gmail, Outlook and
  Apple Mail render the same card.
- No external fonts, images or tracking pixels. The wordmark is Georgia and
  the code is a monospace stack, both of which exist on every device.
- Colours come from the OmaPointii palette: deep green `#0b3d2a`, brand green
  `#0b7a4b`, cream `#f6f1e7`, ink `#1a1712`, saffron `#e8a93c`.
- The code is the largest element, with generous letter spacing so it can be
  read at arm's length while typing.
- A plain "nobody can sign in without the code" line replaces a support link;
  there is no support inbox yet.

### Preview locally

```bash
python3 - <<'PY'
s = open('docs/email-templates/sign-in-code.html').read()
s = s.replace('{{ .Token }}', '482913').replace('{{ .Email }}', 'aino@example.fi').replace('{{ .SiteURL }}', 'https://app.omapointii.store')
open('/tmp/email-preview.html', 'w').write(s)
PY
open /tmp/email-preview.html
```
