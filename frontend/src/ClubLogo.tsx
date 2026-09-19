import { useState } from "react";
import { getClubLogoUrl, isOfficialClubLogo, type ClubIdentity } from "./clubLogos";
import "./ClubLogo.css";

export default function ClubLogo({
  club,
  className = "",
}: {
  club: ClubIdentity;
  className?: string;
}) {
  const source = getClubLogoUrl(club);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = source !== null && failedSource !== source;
  const officialImage = showImage && isOfficialClubLogo(source);

  return (
    <span
      className={`club-logo ${showImage ? "club-logo--image" : "club-logo--fallback"}${officialImage ? " club-logo--official" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          key={source}
          src={source}
          alt=""
          draggable={false}
          onError={() => setFailedSource(source)}
        />
      ) : (
        <span className="club-logo-initials">{club.code.slice(0, 3)}</span>
      )}
    </span>
  );
}
