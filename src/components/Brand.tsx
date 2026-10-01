import Link from "next/link";

export default function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Drummer's Beat home 首页">
      <svg viewBox="0 0 40 40" fill="none" className="brand-mark" aria-hidden="true">
        <circle cx="20" cy="22" r="13" stroke="currentColor" strokeWidth="1.4" />
        <ellipse cx="20" cy="22" rx="8" ry="13" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 22h26M12 4l8 9 8-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>
        <span className="brand-name block">Drummer&apos;s Beat</span>
        <span className="brand-subtitle block">节拍鼓韵</span>
      </span>
    </Link>
  );
}
