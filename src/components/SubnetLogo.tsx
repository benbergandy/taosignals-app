"use client";

import { useEffect, useState } from "react";

type LogoManifest = Record<string, string>;

let manifestPromise: Promise<LogoManifest> | null = null;

function loadManifest(): Promise<LogoManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch("/subnet_logos/manifest.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

function FallbackTao({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#1a1f2c",
        color: "#FFE566",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: Math.round(size * 0.62),
        fontWeight: 700,
        lineHeight: 1,
        border: "1px solid #FFD000",
      }}
    >
      τ
    </span>
  );
}

export default function SubnetLogo({ netuid, size = 18 }: { netuid: number; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [manifestLoaded, setManifestLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadManifest().then((m) => {
      if (cancelled) return;
      const ext = m[String(netuid)];
      setSrc(ext ? `/subnet_logos/${netuid}.${ext}` : null);
      setImgFailed(false);
      setManifestLoaded(true);
    });
    return () => { cancelled = true; };
  }, [netuid]);

  if (!manifestLoaded || !src || imgFailed) {
    return <FallbackTao size={size} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setImgFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        background: "var(--color-surface2)",
      }}
    />
  );
}
