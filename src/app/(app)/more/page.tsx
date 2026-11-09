"use client";

import Link from "next/link";
import { useApp } from "@/components/shell";

export default function MorePage() {
  const { me } = useApp();
  const items = [
    { href: "/parties", title: "Customers and suppliers", text: "The people you sell to and buy from." },
    { href: "/reports", title: "Reports", text: "Registers and tax summaries as PDF or Excel." },
    { href: "/import", title: "Import and export", text: "Bring data in from Excel, or take it out." },
    { href: "/settings", title: "Settings", text: me.role === "owner" ? "Business details, rates, users, backup." : "Your password, rates and HSN codes." },
    { href: "/tutorial", title: "Tutorial", text: "A step-by-step guide to using the app." },
  ];
  return (
    <>
      <h1>More</h1>
      <div className="choices">
        {items.map((i) => (
          <Link key={i.href} className="choice" href={i.href}>
            <b>{i.title}</b>
            {i.text}
          </Link>
        ))}
      </div>
    </>
  );
}
