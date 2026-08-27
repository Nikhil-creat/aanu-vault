"use client";

import { motion } from "framer-motion";

/**
 * A closing vault-dial rendered as an SVG ring. Reads as a literal
 * "sealing" motion as the auto-lock timer counts down — the signature
 * visual element of the AANU shell, used once, quietly, in the top bar.
 */
export default function AutoLockDial({ secondsRemaining, totalSeconds = 180, size = 36 }) {
  const pct = Math.max(0, Math.min(1, secondsRemaining / totalSeconds));
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * pct;
  const urgent = secondsRemaining <= 20;

  return (
    <div className="relative flex items-center gap-2" title="Time until auto-lock">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#20242b"
          strokeWidth="3"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? "#c96e4e" : "#22d3ee"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ ease: "linear", duration: 0.9 }}
        />
      </svg>
      <span
        className={`text-xs tabular-nums font-mono ${
          urgent ? "text-[#c96e4e]" : "text-neutral-500"
        }`}
      >
        {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, "0")}
      </span>
    </div>
  );
}
