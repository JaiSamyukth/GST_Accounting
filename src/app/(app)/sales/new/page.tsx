"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SaleEditor } from "@/components/sale-editor";

function NewSale() {
  const t = useSearchParams().get("type");
  const docType = t === "credit_note" || t === "debit_note" ? t : "invoice";
  return <SaleEditor key={docType} docType={docType} />;
}

export default function NewSalePage() {
  return <Suspense><NewSale /></Suspense>;
}
