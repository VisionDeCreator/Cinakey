# Internationalisation

The web app and admin panel share the localization API exported by
`@cinakey/ui/i18n`. Both offer English, French, Spanish, Korean, Japanese,
and Simplified Chinese. The web app keeps its language selector in Settings; the admin panel places it
in the top navigation bar. Both sign-in screens also offer a selector beneath
the form. Selectors use the shared application dropdown styles.

The initial language uses the saved `cinakey.locale` browser preference, then
supported browser languages, then English. Preferences persist per origin and
sync between tabs on the same origin. The apps may run on different origins,
so each keeps its own saved preference. Storage restrictions do not prevent
switching languages for the current session. Switching updates the document's
`lang` and subscribes components without remounting forms or editors.

## Writing interface text

Use `useLocale()` in components that call `t`, format dates/numbers, or read
translated metadata. For plain text, `<I18nText text="Save changes" />` includes
its own subscription. The English source is the catalog key and the fallback.

```tsx
import { t, useLocale } from "@cinakey/ui/i18n";

function Example({ name }: { name: string }) {
  useLocale();
  return <p>{t("View {0}", { 0: name })}</p>;
}
```

Use complete messages with placeholders; give translators control over word
order. For counts, `tn(one, other, count)` selects with `Intl.PluralRules` and
provides a localized `{count}`. Avoid assembling a sentence from translated
words. Dynamic values remain React text, rather than HTML.

Catalogs live in `packages/ui/src/locales/{en,fr,es,ko,ja,zh}.json`.
Add new English keys and matching entries to all catalogs. Keep API values,
routes, identifiers, keyboard shortcuts, generation prompts and user-created
names/content unchanged. Only translate their explicit interface labels.
Unknown service error text falls back to its original message; arbitrary
server responses and generated content are not machine-translated at runtime.

Dates use the selected language with the browser's timezone. Relative dates use
`Intl.RelativeTimeFormat`. The shared UI `formatUsd` formats USD according to
the selected locale while retaining micro-dollar precision. Currency values
and backend billing calculations remain in USD.

## Validation and translation maintenance

Run `bun run check:i18n` to verify catalog parity, nonempty translations,
placeholder preservation, and static translation references in source files.
Web localization tests cover all languages, live switching without form reset,
persistence, tab synchronization, unavailable storage, fallback, interpolation,
plural rules, and monetary precision. Admin sign-in also has a language-switch
regression test.

The initial translations were generated with the user's DeepSeek account and
reviewed for key UI and filmmaking terminology. Human linguistic review can
refine wording without changing keys. No runtime translation service is used.

`python3 scripts/i18n/translate.py` is an explicit maintenance command for new
catalog entries. It reads only the configured `DEEPSEEK_API_KEY` from the
process or root `.env`, and sends catalog text to the official DeepSeek API.
It does not send environment files, credentials in prompts, or user content.
It preserves validated translations, checks response structure and placeholders,
and records token usage in `docs/evidence/i18n-translation-usage.json`.
Before every request it reserves a conservative maximum using UTF-8 input
bytes, framing overhead, bounded output, and published peak rates. The retained
ledger enforces a cumulative $0.95 cap, including retries and uncertain calls.
Do not delete the ledger to restart the budget.

Preview evidence is saved in `docs/evidence/i18n/`.
