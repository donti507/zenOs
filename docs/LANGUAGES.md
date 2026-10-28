# English and Polish / English i polski

ZEN OS includes English and Polish interface versions. Use the **EN / PL** buttons on the landing/sign-in/legal pages, public gallery/challenges, or the app header/sidebar. The switch is also available on a 390px mobile screen and in dark mode.

On first visit, the first supported browser language chooses English or Polish; English is the fallback. An explicit choice takes priority and is stored in this browser as `zenos_ui_language`. Other tabs update through the browser storage event. The choice survives sign-out/reload, applies to public and signed-in/local screens, and is an appearance preference rather than shared workspace data. Blocking storage does not prevent switching for the current session.

**No new SQL, API key, environment variable or paid translation service is needed.** Merge and redeploy the frontend/server together. Previously added features still require their existing migrations/configuration.

## What changes

Navigation, public copy, sign-in/password forms, dialogs, controls, built-in statuses, accessibility labels, common application errors, date presentation and generated UI summaries use the selected language. Polish dates use `pl-PL`; stored date keys, time zones, recurrence rules, quota reset times, IDs and status values do not change. Number forms use Polish plural rules where count labels are assembled. Switching leaves existing inputs/drafts mounted and does not save, rename or modify workspace data.

Authored task titles, categories, meeting notes, vault descriptions, chat history, lecture content, generated code/explanations, public pages, author names and model IDs are displayed as saved. They are not machine-translated when switching the interface. This includes existing default category names stored with workspace data. Unknown application/external-provider messages fall back to their original text; browser-native controls, Google/Stripe and other external interfaces have their own language settings. Translations are static application copy and never send text to an outside translation service.

Dante receives the interface preference (`uiLanguage`) in its prompt, with user language requests taking precedence. Built-in assistant prompts and recap playback text are localized while preserving interpolated task titles/notes. Selecting a different interface language selects the corresponding English/Polish speech preference; existing voice/rate settings otherwise remain available. Polish speech still needs a Polish browser voice or a configured server TTS model/voice that supports Polish. Language changes do not call the model or spend the daily allowance. Private shared Dante contexts retain the language preference but continue to load only authorized workspace data on the server.

## Development

`src/i18n/index.ts` owns the browser preference, React subscriptions, `tr()` text/interpolation, `uiLocale()`/`speechLocale()` and count formatting. ZenosContext exposes the same preference/setter. Keep the EN/PL switch outside route/account keys so it does not remount app forms. `document.documentElement.lang` follows the preference.

Use `tr('English source copy')` for application-owned copy, with Polish in `src/i18n/pl.ts`. Parameterized keys use `{{0}}`, `{{1}}`, etc.; interpolate dynamic values as arguments, never concatenate user text into dictionary keys or render translations as HTML. Display authored fields directly. UI metadata defined at module scope uses live getters so its localized labels do not freeze at module import; keep enum values, routing keys and business comparisons untranslated. Components with standalone copy use `useUiLanguage()` to refresh in place. Stored model answers, code diffs and sandbox `srcdoc` are outside the translation layer.

`src/i18n/actions.ts` translates known application-generated action templates and leaves captured titles untouched. `recaps.ts` formats only canonical counts and fixed recap suggestions. Unknown provider prose is never guessed at or sent elsewhere for translation.

Run `npm run typecheck`, `npm test`, `npm run build`. Tests cover browser detection/explicit persistence, blocked storage, cross-tab language changes, Polish plural/date formatting, canonical Dante language context, safe interpolation, authored-content preservation, mounted login/task drafts, canonical task enum writes and catalogue completeness. Browser verification should include public/sign-in pages, new/edit task dialogs, calendar, Dante voice controls and dark/mobile layout.
