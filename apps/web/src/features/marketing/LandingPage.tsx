import { useRegistrationPolicy } from "../auth/useRegistrationPolicy";
import {
  I18nText,
  t,
  useLocale,
  LanguageSelector,
  formatUsd,
} from "@dirrio/ui/i18n";
import desertImage from "./images/desert.jpg";
import characterImage from "./images/character.jpg";
import stagingImage from "./images/staging.jpg";
import creatorImage from "./images/creator.jpg";
import teamImage from "./images/team.jpg";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useConvexAuth } from "@/lib/api/hooks";
import {
  VIDEO_RATES,
  WORKSPACE_MONTHLY_USD_MICROS,
  ADDITIONAL_SEAT_MONTHLY_USD_MICROS,
  INCLUDED_MONTHLY_USAGE_USD_MICROS,
} from "@dirrio/shared";
import {
  ArrowRight,
  Clapperboard,
  FileText,
  Images,
  Film,
  Scissors,
  Layers,
  Sparkles,
  Box,
  Users,
  ShieldCheck,
  LoaderCircle,
  Check,
  ChevronDown,
} from "lucide-react";
import "./marketing.css";
import { FeaturePreview } from "./FeaturePreview";
import { FeatureGuide } from "./FeatureGuide";
const features = [
  {
    Icon: Clapperboard,
    title: "Studio",
    text: "Bring scripts, references, generation, previews, and timeline editing into one connected workspace.",
  },
  {
    Icon: Layers,
    title: "Series & shared libraries",
    text: "Organize episodes and reuse characters, locations, and creative resources across your series.",
  },
  {
    Icon: Box,
    title: "3D staging",
    text: "Plan camera movement and scene timing before using your preview as a generation reference.",
  },
  {
    Icon: Images,
    title: "Assets & references",
    text: "Keep images, video, audio, and creative references organized alongside your projects.",
  },
  {
    Icon: Users,
    title: "Teams & sharing",
    text: "Work together with workspace roles, project assignments, and links to finished videos.",
  },
];
const artwork: Record<string, string> = {
  desert: desertImage,
  character: characterImage,
  staging: stagingImage,
  creator: creatorImage,
  team: teamImage,
};
const art = (name: string) => artwork[name]!;

function Waitlist({ requireApproval }: { requireApproval: boolean }) {
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  if (!requireApproval)
    return (
      <section id="early-access" className="marketing-waitlist">
        <div className="marketing-waitlist-story">
          <h2>
            <I18nText text="Start free trial" />
          </h2>
          <p>
            <I18nText text="Registration is open. Sign up with a verified email to get started." />
          </p>
          <Link className="marketing-primary" to="/sign-up">
            <I18nText text="Start free trial" />
          </Link>
        </div>
      </section>
    );
  return (
    <section id="early-access" className="marketing-waitlist">
      <div className="marketing-waitlist-story">
        <img
          src={art("desert")}
          alt=""
          loading="lazy"
          className="marketing-waitlist-art"
        />
        <span className="marketing-eyebrow">
          <I18nText text="INVITE-ONLY EARLY ACCESS" />
        </span>
        <h2>
          <I18nText text="Bring your next story to Dirrio." />
        </h2>
        <p>
          <I18nText text="For creators and small production teams. Join the waitlist and tell us what you want to make." />
        </p>
        <p className="marketing-access-note">
          <ShieldCheck size={18} />
          <I18nText text="Invitations are reviewed manually. Joining the waitlist does not create an account or grant app access." />
        </p>
      </div>
      {done ? (
        <div className="marketing-request-success" role="status">
          <ShieldCheck size={32} />
          <h3>
            <I18nText text="Your request is received." />
          </h3>
          <p>
            <I18nText text="We’re inviting creators and teams in batches. We’ll email you if your request is approved." />
          </p>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const res = await fetch(
                `${(import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "")}/early-access`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email, name, idea, website, locale }),
                },
              );
              if (!res.ok)
                throw new Error(
                  res.status === 429
                    ? t("Please wait a little before trying again.")
                    : t("We couldn’t save your request. Please try again."),
                );
              setDone(true);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : t("Request failed. Please try again."),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            <I18nText text="Email" />
            <input
              required
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("you@example.com")}
              disabled={busy}
            />
          </label>
          <label>
            <I18nText text="Name" />
            <span>
              <I18nText text="(optional)" />
            </span>
            <input
              autoComplete="name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <I18nText text="What would you like to create?" />
            <span>
              <I18nText text="(optional)" />
            </span>
            <textarea
              rows={3}
              maxLength={1000}
              aria-describedby="waitlist-idea-count"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={busy}
            />
          </label>
          <p id="waitlist-idea-count" className="marketing-form-note">
            {t("{0} / {1} characters", {
              0: idea.length.toLocaleString(locale),
              1: (1000).toLocaleString(locale),
            })}
          </p>
          <label className="marketing-honeypot" aria-hidden="true">
            <I18nText text="Website" />
            <input
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
          <button className="marketing-primary" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : null}
            {t(busy ? "Sending request…" : "Request early access")}
            <ArrowRight size={18} />
          </button>
          <p className="marketing-form-note">
            <I18nText text="We’ll use these details to review your request and contact you about early access." />
          </p>
          {error && (
            <p role="alert" className="marketing-form-error">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
export function LandingPage() {
  useLocale();
  const requireApproval = useRegistrationPolicy();
  const { isAuthenticated } = useConvexAuth();
  return (
    <div className="marketing-page">
      <header className="marketing-nav">
        <Link className="marketing-brand" to="/" aria-label={t("Dirrio home")}>
          <Clapperboard />
          Dirrio
        </Link>
        <nav aria-label={t("Public navigation")}>
          <a href="#workflow">
            <I18nText text="Workflow" />
          </a>
          <a href="#features">
            <I18nText text="Features" />
          </a>
          <a href="#pricing">
            <I18nText text="Pricing" />
          </a>
        </nav>
        <div>
          <Link to={isAuthenticated ? "/projects" : "/sign-in"}>
            {t(isAuthenticated ? "Open app" : "Sign in")}
          </Link>
          <a
            className="marketing-primary"
            href={requireApproval ? "#early-access" : "/sign-up"}
          >
            {requireApproval ? (
              <I18nText text="Request early access" />
            ) : (
              <I18nText text="Start free trial" />
            )}
          </a>
        </div>
      </header>
      <main>
        <div className="marketing-hero-layout">
          <section className="marketing-hero">
            <span className="marketing-trial-badge">
              <I18nText text="7-day workspace trial" />
            </span>
            <span className="marketing-eyebrow">
              {requireApproval ? (
                <I18nText text="INVITE-ONLY EARLY ACCESS" />
              ) : (
                <I18nText text="OPEN REGISTRATION" />
              )}
            </span>
            <h1>
              <I18nText text="Your story. One creative workspace." />
            </h1>
            <p>
              <I18nText text="Write, generate, edit, and share videos—with the tools to keep every scene connected." />
            </p>
            <div className="marketing-hero-actions">
              <a
                className="marketing-primary"
                href={requireApproval ? "#early-access" : "/sign-up"}
              >
                {requireApproval ? (
                  <I18nText text="Request early access" />
                ) : (
                  <I18nText text="Start free trial" />
                )}
                <ArrowRight size={18} />
              </a>
              <a className="marketing-secondary" href="#workflow">
                <I18nText text="Explore the workflow" />
              </a>
            </div>
            <div className="marketing-trial-promises">
              <span>
                <Check size={16} />
                <I18nText text="No card required" />
              </span>
              <span>
                <Check size={16} />
                <I18nText text="No automatic subscription charge" />
              </span>
            </div>
            <div className="marketing-trial-summary">
              <strong>
                <I18nText text="Try the workspace free for seven days" />
              </strong>
              <p>
                <I18nText text="Your trial starts with your first project, not signup. AI generation credits are purchased separately." />
              </p>
              <a href="#trial-details">
                <I18nText text="How the trial works" />
              </a>
            </div>
            <small>
              {requireApproval ? (
                <I18nText text="For creators and small production teams. Access is approved manually." />
              ) : (
                <I18nText text="Registration is open. Sign up with a verified email to get started." />
              )}
            </small>
          </section>
          <section
            className="marketing-studio"
            aria-label={t("Illustrative Studio workflow preview")}
          >
            <header>
              <span>
                <Clapperboard size={20} />
                Dirrio{" "}
                <b>
                  <I18nText text="Studio" />
                </b>
              </span>
              <span>
                <I18nText text="Script → References → Generation → Edit" />
              </span>
            </header>
            <div className="marketing-studio-panels">
              <aside>
                <h3>
                  <I18nText text="Project media" />
                </h3>
                <div className="marketing-media-grid">
                  {["Characters", "Locations", "Footage", "References"].map(
                    (title, i) => (
                      <div key={title}>
                        <img
                          src={art(
                            ["character", "desert", "staging", "desert"][i]!,
                          )}
                          alt=""
                          style={{ objectPosition: `${i * 30}% center` }}
                        />
                        <span>{t(title)}</span>
                      </div>
                    ),
                  )}
                </div>
              </aside>
              <div className="marketing-studio-preview">
                <img
                  src={art("desert")}
                  alt={t(
                    "Example creative imagery in a Studio workflow preview",
                  )}
                />
                <span>
                  <Film size={16} />
                  <I18nText text="Preview your next scene" />
                </span>
              </div>
              <aside className="marketing-script-preview">
                <span className="marketing-script-tabs">
                  <I18nText text="Script" />
                  <span>
                    <I18nText text="Generation" />
                  </span>
                </span>
                <h3>
                  <I18nText text="Scene 01" />
                </h3>
                <p>
                  <I18nText text="Describe the scene. Add your references. Shape the next moment of your story." />
                </p>
                <div className="marketing-reference-chip">
                  <Images size={18} />
                  <I18nText text="Connected references" />
                </div>
                <p className="marketing-preview-action">
                  <Sparkles size={16} />
                  <I18nText text="Generate footage" />
                </p>
              </aside>
            </div>
            <div className="marketing-timeline">
              <span>
                <I18nText text="Video" />
              </span>
              {["desert", "character", "desert", "staging"].map(
                (name, index) => (
                  <div key={index}>
                    <img src={art(name)} alt="" />
                  </div>
                ),
              )}
              <span>
                <I18nText text="Audio" />
              </span>
              <i />
            </div>
            <p className="marketing-illustration-label">
              <I18nText text="Illustrative workflow preview" />
            </p>
          </section>
        </div>
        <section id="workflow" className="marketing-section">
          <h2>
            <I18nText text="From first idea to final cut" />
          </h2>
          <div className="marketing-workflow">
            {[
              {
                Icon: FileText,
                title: "Write your script",
                text: "Shape your story and connect the references that guide it.",
              },
              {
                Icon: Images,
                title: "Build your references",
                text: "Bring together the images, footage, and assets that define your vision.",
              },
              {
                Icon: Film,
                title: "Generate your footage",
                text: "Create scenes from your script and references, with estimates before generation.",
              },
              {
                Icon: Scissors,
                title: "Edit and share",
                text: "Assemble your story on the timeline and share the finished video.",
              },
            ].map(({ Icon, title, text }, i) => (
              <article key={title}>
                <div>
                  <span>{i + 1}</span>
                  <Icon size={24} />
                </div>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="features" className="marketing-section">
          <h2>
            <I18nText text="A connected production, from scene to series." />
          </h2>
          <div className="marketing-features">
            {features.map(({ Icon, title, text }) => (
              <article key={title}>
                <Icon size={28} />
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
                <FeaturePreview title={title} />
              </article>
            ))}
            <FeatureGuide variant="card" />
          </div>
        </section>
        <section className="marketing-section">
          <h2>
            <I18nText text="Create solo. Build together." />
          </h2>
          <div className="marketing-audiences">
            <article className="marketing-audience-creator">
              <img
                src={art("creator")}
                alt={t("A creator editing a film in a warmly lit studio")}
                loading="lazy"
              />
              <FileText size={24} />
              <h3>
                <I18nText text="One place for your creative workflow." />
              </h3>
              <p>
                <I18nText text="Plan, generate, and edit your story from start to finish." />
              </p>
            </article>
            <article className="marketing-audience-team">
              <img
                src={art("team")}
                alt={t("A small production team reviewing footage together")}
                loading="lazy"
              />
              <Users size={24} />
              <h3>
                <I18nText text="Shared resources. A connected team." />
              </h3>
              <p>
                <I18nText text="Keep your production organized with episodes, shared libraries, and workspace permissions." />
              </p>
            </article>
          </div>
        </section>
        <section id="pricing" className="marketing-section marketing-pricing">
          <span className="marketing-eyebrow">
            <I18nText text="PRICING" />
          </span>
          <h2>
            <I18nText text="Start free. Build at your pace." />
          </h2>
          <p>
            <I18nText text="Try the workspace for 7 days. Subscribe when you’re ready." />
          </p>
          <div className="marketing-price-grid">
            <article className="marketing-workspace-plan">
              <span className="marketing-trial-badge">
                <I18nText text="7-day workspace trial" />
              </span>
              <h3>
                <I18nText text="Workspace" />
              </h3>
              <strong>
                {formatUsd(WORKSPACE_MONTHLY_USD_MICROS)}
                <span>
                  <I18nText text="/ month after trial" />
                </span>
              </strong>
              <p>
                {t(
                  "Includes the owner and {amount} of workspace usage per paid monthly period. Unused allowance does not roll over.",
                  {
                    amount: formatUsd(INCLUDED_MONTHLY_USAGE_USD_MICROS),
                  },
                )}
              </p>
              <ul className="marketing-plan-benefits">
                {[
                  "1 creator seat included",
                  "Studio, shared libraries & 3D staging",
                  "Editing, exports & sharing",
                ].map((label) => (
                  <li key={label}>
                    <Check size={16} />
                    {t(label)}
                  </li>
                ))}
              </ul>
              <a
                className="marketing-primary"
                href={requireApproval ? "#early-access" : "/sign-up"}
              >
                {t(
                  requireApproval ? "Request early access" : "Start free trial",
                )}
                <ArrowRight size={16} />
              </a>
              <p className="marketing-plan-disclosure">
                <I18nText text="No free AI generation credits. No automatic subscription charge." />
              </p>
            </article>
            <div className="marketing-plan-addons">
              <article>
                <Users size={24} aria-hidden="true" />
                <h3>
                  <I18nText text="Additional seats" />
                </h3>
                <strong>
                  {formatUsd(ADDITIONAL_SEAT_MONTHLY_USD_MICROS)}
                  <span>
                    <I18nText text="/ month each" />
                  </span>
                </strong>
                <p>
                  <I18nText text="For additional Admins and Creators. Additional seats do not add usage allowance." />
                </p>
              </article>
              <article>
                <Sparkles size={24} aria-hidden="true" />
                <h3>
                  <I18nText text="Generation" />
                </h3>
                <strong>
                  {formatUsd(VIDEO_RATES["seedance-2.5"]["720p"])}
                  <span>
                    <I18nText text="/ second" />
                  </span>
                </strong>
                <p>
                  <I18nText text="Seedance 2.5 at 720p. Rates vary by model and resolution. The app shows an estimate before submission." />
                </p>
              </article>
            </div>
          </div>
          <div className="marketing-pricing-value">
            <p>
              <I18nText text="Script, references, generation, editing, and sharing in one workspace. Generation and other metered usage draw from your allowance; additional usage is billed separately." />
            </p>
            <FeatureGuide />
          </div>
          <p className="marketing-form-note">
            <I18nText text="USD, plus applicable tax. Generation estimates may reserve a rounded maximum; final charges follow the app’s usage settlement." />
          </p>
          <section
            id="trial-details"
            className="marketing-trial-details"
            aria-labelledby="trial-details-title"
          >
            <div className="marketing-trial-intro">
              {" "}
              <h3 id="trial-details-title">
                <I18nText text="How the seven-day trial works" />
              </h3>
              <ol className="marketing-trial-steps">
                {[
                  "Verify your account",
                  "Create your first project",
                  "Your 7-day workspace trial begins",
                ].map((label, index) => (
                  <li key={label}>
                    <span>{index + 1}</span>
                    {t(label)}
                  </li>
                ))}
              </ol>
            </div>
            <div className="marketing-trial-questions">
              <div className="marketing-trial-accordion">
                <details open>
                  <summary>
                    <I18nText text="When does my trial start?" />
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="marketing-trial-answer">
                    <I18nText text="Your seven days begin when you create your first project, series or transformation with a verified account. Signing up does not start the clock. The trial includes one creator seat." />
                  </div>
                </details>
                <details>
                  <summary>
                    <I18nText text="Do I need a card or generation credits?" />
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="marketing-trial-answer">
                    <I18nText text="No card is required to start the workspace trial. AI generation requires purchased credits, shown as a USD balance, starting at $10 plus applicable tax. No free generation credits are included. Usage depends on the model and settings; review the estimate before generating." />
                  </div>
                </details>
                <details>
                  <summary>
                    <I18nText text="What happens when the trial ends?" />
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="marketing-trial-answer">
                    <I18nText text="Purchased credits do not expire. While a balance remains, you can create projects, edit scripts, upload image/video references and generate videos. A subscription is required for timeline editing, staging, series, collaboration, sharing and more credits. When your purchased balance reaches zero, creation, script editing, uploads and generation pause. Viewing, downloads and existing exports remain available." />
                  </div>
                </details>
                <details>
                  <summary>
                    <I18nText text="Do my credits or projects expire?" />
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="marketing-trial-answer">
                    <I18nText text="Purchased credits do not expire and carry over if you subscribe. Your projects and media are retained indefinitely for now, including after your trial, unless you delete them. The paid plan's monthly included usage is separate and does not roll over." />
                  </div>
                </details>
                <details>
                  <summary>
                    <I18nText text="Will I be charged automatically?" />
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="marketing-trial-answer">
                    {t(
                      "There is no automatic subscription charge when the trial ends. Subscribe explicitly for {subscription}/month, including one creator and {usage} of monthly generation usage. Additional creators are {seat}/month each. Prices are in USD, plus applicable tax.",
                      {
                        subscription: formatUsd(WORKSPACE_MONTHLY_USD_MICROS),
                        usage: formatUsd(INCLUDED_MONTHLY_USAGE_USD_MICROS),
                        seat: formatUsd(ADDITIONAL_SEAT_MONTHLY_USD_MICROS),
                      },
                    )}
                  </div>
                </details>
              </div>
            </div>
          </section>
          <a
            className="marketing-secondary"
            href={requireApproval ? "#early-access" : "/sign-up"}
          >
            {requireApproval ? (
              <I18nText text="Request early access" />
            ) : (
              <I18nText text="Start free trial" />
            )}
            <ArrowRight size={18} />
          </a>
        </section>
        <Waitlist requireApproval={requireApproval} />
      </main>
      <footer className="marketing-footer">
        <Link className="marketing-brand" to="/">
          <Clapperboard />
          Dirrio
        </Link>
        <span>© {new Date().getFullYear()} Dirrio</span>
        <a href="#pricing">
          <I18nText text="Pricing" />
        </a>
        <Link to="/sign-in">
          <I18nText text="Sign in" />
        </Link>
        <a href={requireApproval ? "#early-access" : "/sign-up"}>
          {requireApproval ? (
            <I18nText text="Request early access" />
          ) : (
            <I18nText text="Start free trial" />
          )}
        </a>
        <LanguageSelector />
      </footer>
    </div>
  );
}
