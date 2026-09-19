import { useState } from "react";
import type { Career } from "./types";
import LegendEventsView from "./LegendEventsView";
import TransferMarketPanel from "./TransferMarketPanel";
import PlayerSalesPanel from "./PlayerSalesPanel";
import "./MarketView.css";

interface Props {
  career: Career;
  token: string;
  initialSection?: "players" | "legends";
  onBack: () => void;
  onOpenSeason: () => void;
  onCareerUpdated: () => Promise<void>;
  onOpenContractOffer: (id: number) => void;
}
export default function MarketView(props: Props) {
  const [section, setSection] = useState(props.initialSection ?? "players");
  return (
    <section className="market-page">
      <nav className="market-section-title">
        <button onClick={props.onBack}>← 구단 사무실</button>
        <button onClick={props.onOpenSeason}>시즌 허브 →</button>
      </nav>
      <header className="market-hero">
        <p className="market-kicker">CLUB OFFICE / TRANSFER MARKET</p>
        <h1>일반 시장</h1>
        <p>선수 영입과 판매 현황, 그리고 시대를 빛낸 레전드까지 한곳에서.</p>
      </header>
      <div className="market-tabs" role="group" aria-label="시장 구역">
        <button
          aria-pressed={section === "players"}
          onClick={() => setSection("players")}
        >
          전체 선수 · FA
        </button>
        <button
          aria-pressed={section === "legends"}
          onClick={() => setSection("legends")}
        >
          레전드 시장
        </button>
      </div>
      {section === "players" ? (
        <>
          <TransferMarketPanel
            career={props.career}
            token={props.token}
            onOpenContractOffer={props.onOpenContractOffer}
          />
          <PlayerSalesPanel
            career={props.career}
            token={props.token}
            onCareerUpdated={props.onCareerUpdated}
            onOpenSeason={props.onOpenSeason}
          />
        </>
      ) : (
        <LegendEventsView {...props} embedded />
      )}
    </section>
  );
}
