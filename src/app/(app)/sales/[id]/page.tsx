"use client";

import { use } from "react";
import { SaleEditor, type SaleDoc } from "@/components/sale-editor";
import { Err, Loading, useLoad } from "@/components/ui";

export default function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useLoad<{ doc: SaleDoc; lines: never[] }>(`/api/sales/${encodeURIComponent(id)}`);
  if (error) return <Err error={error} />;
  if (!data) return <Loading />;
  return <SaleEditor existing={data} />;
}
