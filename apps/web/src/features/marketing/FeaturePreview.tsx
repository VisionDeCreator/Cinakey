import { I18nText, t, useLocale } from "@dirrio/ui/i18n";
import desertImage from "./images/desert.jpg";
import characterImage from "./images/character.jpg";
import stagingImage from "./images/staging.jpg";
const artwork: Record<string, string> = {
  desert: desertImage,
  character: characterImage,
  staging: stagingImage,
};
const art = (name: string) => artwork[name]!;
export function FeaturePreview({ title }: { title: string }) {
  useLocale();
  if (title === "Studio")
    return (
      <div className="marketing-mini-studio">
        <div>
          <img
            src={art("desert")}
            alt={t("Illustrative desert footage preview")}
            loading="lazy"
          />
          <aside>
            <span>
              <I18nText text="Script" />
            </span>
            <p>
              <I18nText text="A traveler crosses the valley at sunrise." />
            </p>
            <span>
              <I18nText text="Generation" />
            </span>
          </aside>
        </div>
        <div className="marketing-mini-tracks">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  if (title === "Series & shared libraries" || title === "Assets & references")
    return (
      <div className="marketing-mini-library">
        <header>
          {t(title === "Assets & references" ? "References" : "Shared library")}
          <span>
            <I18nText text="Characters · Locations" />
          </span>
        </header>
        <div>
          {[
            { src: "character", label: "Maya" },
            { src: "desert", label: "Desert valley" },
            { src: "staging", label: "Scene plan" },
          ].map((item) => (
            <figure key={item.src}>
              <img src={art(item.src)} alt={t(item.label)} loading="lazy" />
              <figcaption>{t(item.label)}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    );
  if (title === "3D staging")
    return (
      <div className="marketing-mini-staging">
        <img
          src={art("staging")}
          alt={t("Gray clay scene with camera movement guides")}
          loading="lazy"
        />
        <span>
          <I18nText text="Plan camera & movement" />
        </span>
      </div>
    );
  return (
    <div className="marketing-mini-team">
      <header>
        <I18nText text="Team" />
        <span>
          <I18nText text="Workspace roles" />
        </span>
      </header>
      {[
        { initial: "J", name: "Jordan", role: "Owner" },
        { initial: "T", name: "Taylor", role: "Admin" },
        { initial: "R", name: "Riley", role: "Creator" },
      ].map((member) => (
        <div key={member.name}>
          <i>{member.initial}</i>
          <span>{member.name}</span>
          <small>{t(member.role)}</small>
        </div>
      ))}
    </div>
  );
}
