import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@dirrio/ui/dialog";
import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import {
  ArrowRight,
  Clapperboard,
  Images,
  Sparkles,
  Box,
  Scissors,
  Layers,
  Link2,
  Users,
  CircleHelp,
  LayoutGrid,
  Info,
} from "lucide-react";
import { useRef, useState } from "react";
import { FeaturePreview } from "./FeaturePreview";
import desertImage from "./images/desert.jpg";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@dirrio/ui/select";

const sections = [
  {
    title: "Studio",
    description:
      "Write scripts and link images or video with @ references. Each generation saves its script, references, and settings so you can revisit how a shot was made.",
    notes: [],
  },
  {
    title: "Assets & references",
    description:
      "Upload and organize images, video, and audio. Build character, creature, location, and prop references; use the image workbench to develop the look before generating footage.",
    notes: [],
  },
  {
    title: "Generation",
    description:
      "Choose generation settings, review the estimate, and preview results before adding them to your edit. For example, try another version of a scene without replacing your saved timeline.",
    notes: [
      "This generation model supports one distinct reference video. Use one video reference before generating.",
    ],
  },
  {
    title: "3D staging",
    description:
      "Arrange a 3D scene, adjust the lens, and keyframe camera moves and timing. Export a staging preview to guide generation—for example, plan a camera move before spending on a generated shot.",
    notes: [],
  },
  {
    title: "Edit and share",
    description:
      "Assemble video and audio on the timeline, split and trim clips, adjust playback and volume, and add captions. Restore earlier timeline versions, then export your saved edit as MP4 in a compatible browser.",
    notes: [],
  },
  {
    title: "Series & shared libraries",
    description:
      "Group projects into series and episodes. Reuse shared characters, locations, props, and media; episodes keep their chosen resource versions when you publish library updates.",
    notes: [
      "Episodes keep their chosen versions. Publish updates when your resources evolve.",
    ],
  },
  {
    title: "Share & videos",
    description:
      "Store finished exports and create viewing links with optional passwords, expiry dates, and download controls. Share a review copy without giving the recipient workspace access.",
    notes: [
      "Up to 200 MiB per video",
      "Stored videos are snapshots. Later edits won’t change their links. Workspace storage limit: 5 GiB.",
    ],
  },
  {
    title: "Teams & sharing",
    description:
      "Invite Admins and Creators and assign access to projects or series. Track spent and reserved usage, and set workspace, series, or episode spending caps before starting more generation.",
    notes: [
      "For additional Admins and Creators. Additional seats do not add usage allowance.",
    ],
  },
  {
    title: "Help and support",
    description: "Ask a question, browse help, or contact our team.",
    notes: ["Start a conversation or browse the knowledge base."],
  },
];

const icons = [
  Clapperboard,
  Images,
  Sparkles,
  Box,
  Scissors,
  Layers,
  Link2,
  Users,
  CircleHelp,
];
export function FeatureGuide({
  variant = "button",
}: {
  variant?: "button" | "card";
}) {
  useLocale();
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const section = sections[active]!;
  const Icon = icons[active]!;
  const choose = (index: number) => {
    setActive(index);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const previewTitle = [
    "Studio",
    "Assets & references",
    "Studio",
    "3D staging",
    "Studio",
    "Series & shared libraries",
    "Studio",
    "Teams & sharing",
    "Teams & sharing",
  ][active]!;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) setActive(0);
      }}
    >
      <DialogTrigger asChild>
        {variant === "card" ? (
          <button
            type="button"
            className="marketing-feature-explore-card"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(28,17,10,.9), rgba(20,12,6,.7)), url(${desertImage})`,
            }}
          >
            <LayoutGrid size={28} aria-hidden="true" />
            <h3>
              <I18nText text="Explore all features" />
            </h3>
            <p>
              <I18nText text="Discover every tool, workflow and practical limit." />
            </p>
            <span className="marketing-explore-link">
              <ArrowRight size={22} aria-hidden="true" />
              <I18nText text="Open feature explorer" />
            </span>
          </button>
        ) : (
          <button type="button" className="marketing-secondary">
            <I18nText text="See all features" />
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="marketing-feature-guide">
        <header>
          <DialogTitle>
            <I18nText text="Explore your creative workspace" />
          </DialogTitle>
          <DialogDescription>
            <I18nText text="Explore the tools, practical uses, and limits before choosing your workspace." />
          </DialogDescription>
        </header>
        <div className="marketing-feature-guide-body">
          <nav
            aria-label={t("Explore all features")}
            className="marketing-feature-guide-nav"
          >
            {sections.map((item, index) => {
              const ItemIcon = icons[index]!;
              return (
                <button
                  type="button"
                  key={item.title}
                  aria-current={active === index ? "true" : undefined}
                  onClick={() => choose(index)}
                >
                  <ItemIcon size={18} aria-hidden="true" />
                  {t(item.title)}
                </button>
              );
            })}
          </nav>
          <div className="marketing-feature-guide-mobile">
            <Select
              value={String(active)}
              onValueChange={(value) => choose(Number(value))}
            >
              <SelectTrigger aria-label={t("Explore all features")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sections.map((item, index) => (
                  <SelectItem key={item.title} value={String(index)}>
                    {t(item.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            className="marketing-feature-guide-scroll"
            ref={scrollRef}
            tabIndex={0}
            role="region"
            aria-label={t(section.title)}
          >
            <div className="marketing-feature-guide-heading">
              <Icon size={28} aria-hidden="true" />
              <h3>{t(section.title)}</h3>
            </div>
            <p className="marketing-feature-guide-description">
              {t(section.description)}
            </p>
            {active !== 8 && (
              <div
                className="marketing-feature-guide-preview"
                aria-hidden="true"
              >
                <FeaturePreview title={previewTitle} />
              </div>
            )}
            {active === 0 && (
              <div className="marketing-feature-guide-highlights">
                <section>
                  <h4>
                    <I18nText text="Write with references" />
                  </h4>
                  <p>
                    <I18nText text="Link characters and media using @ references." />
                  </p>
                </section>
                <section>
                  <h4>
                    <I18nText text="Keep every iteration" />
                  </h4>
                  <p>
                    <I18nText text="Revisit the script and settings behind each generation." />
                  </p>
                </section>
              </div>
            )}
            {section.notes.length > 0 && (
              <section className="marketing-feature-guide-notes">
                <h4>
                  <Info size={16} aria-hidden="true" />
                  <I18nText text="Usage & limits" />
                </h4>
                <ul>
                  {section.notes.map((note) => (
                    <li key={note}>{t(note)}</li>
                  ))}
                </ul>
              </section>
            )}
            <section className="marketing-feature-guide-notes">
              <h4>
                <I18nText text="What your workspace includes" />
              </h4>
              <p>
                <I18nText text="Script, references, generation, editing, and sharing in one workspace. Generation and other metered usage draw from your allowance; additional usage is billed separately." />
              </p>
            </section>
          </div>
        </div>
        <footer>
          <span>
            <I18nText text="Explore tools here. Compare costs on Pricing." />
          </span>
          <DialogClose asChild>
            <a className="marketing-secondary" href="/#pricing">
              <I18nText text="Pricing" />
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
